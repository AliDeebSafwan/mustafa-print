import type { Pool } from 'pg';
import { isMutationKind, MUTATION_PAYLOADS, type Mutation, type MutationResult, type PushRequest, type PushResponse } from '@mpe/shared';
import { withTransaction } from '../../db/pool';
import { formatIssues } from '../../http-error';
import type { AuthContext } from '../auth/types';
import { HANDLERS } from './handlers';
import { MutationConflict, MutationRejected, type Handler, type HandlerContext, type HandlerResult } from './handlers/types';

export interface PushDeps {
  pool: Pool;
  publicWebUrl: string;
  /** Tells the website to refresh; called once per push that changed something it shows (products). */
  onPublicChange?: () => void;
}

/** Tables whose rows the public website shows. A change to them must reach the site at once. */
const PUBLIC_ENTITIES = new Set(['products']);

type Outcome =
  | ({ result: 'applied' } & HandlerResult)
  | { result: 'conflict'; error: string; row: Record<string, unknown>; rowEntity: NonNullable<HandlerResult['rowEntity']> }
  | { result: 'rejected'; error: string };

/** Database integrity errors mean "this mutation can never work as sent", not "the server is broken". */
const INTEGRITY_ERRORS: Record<string, string> = {
  '23502': 'missing_value', '23503': 'reference_not_found', '23505': 'already_exists', '23514': 'constraint_violation', P0001: 'rule_violation',
};

function toOutcome(err: unknown): Outcome | null {
  if (err instanceof MutationRejected) return { result: 'rejected', error: err.message };
  if (err instanceof MutationConflict) return { result: 'conflict', error: err.message, row: err.row, rowEntity: err.rowEntity };
  const { code, constraint, message } = err as { code?: string; constraint?: string; message?: string };
  if (code && INTEGRITY_ERRORS[code]) return { result: 'rejected', error: `${INTEGRITY_ERRORS[code]}: ${constraint ?? message ?? ''}`.trim() };
  return null;
}

async function apply(client: HandlerContext['client'], ctx: HandlerContext, m: Mutation): Promise<Outcome> {
  const kind = `${m.entity}:${m.op}`;
  if (!isMutationKind(kind)) return { result: 'rejected', error: `unsupported_mutation: ${kind}` };

  const parsed = MUTATION_PAYLOADS[kind].safeParse(m.payload);
  if (!parsed.success) return { result: 'rejected', error: `invalid_payload: ${formatIssues(parsed.error)}` };

  // A savepoint lets a failed mutation undo its partial writes while the outcome record below still commits.
  await client.query('SAVEPOINT mutation');
  try {
    // The registry is typed per kind; `kind` is a runtime union here, so the payload type is narrowed by the schema lookup above.
    const handler = HANDLERS[kind] as Handler<typeof kind>;
    const output = await handler(ctx, { entityId: m.entityId, payload: parsed.data as never });
    await client.query('RELEASE SAVEPOINT mutation');
    return { result: 'applied', ...output };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT mutation');
    const outcome = toOutcome(err);
    if (outcome) return outcome;
    throw err;                                            // a real fault: fail the request, the device retries later
  }
}

async function processOne(deps: PushDeps, auth: AuthContext, deviceId: string, m: Mutation): Promise<MutationResult> {
  return withTransaction(deps.pool, async (client) => {
    // Serialises retries of the SAME mutation (e.g. the response was lost and the device resends while the first is in flight).
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [m.id]);

    const seen = (await client.query<{ branch_id: string; result: string; error: string | null }>(
      'SELECT branch_id, result, error FROM client_mutations WHERE id = $1', [m.id])).rows[0];
    if (seen) {
      if (seen.branch_id !== auth.branchId) return { id: m.id, result: 'rejected', error: 'id_in_use' };
      // A repeat of something applied is "duplicate"; a repeat of a conflict/rejection gets the same verdict again.
      return seen.result === 'applied' ? { id: m.id, result: 'duplicate' } : { id: m.id, result: seen.result as 'conflict' | 'rejected', error: seen.error ?? undefined };
    }

    const ctx: HandlerContext = { client, auth, deviceId, publicWebUrl: deps.publicWebUrl };
    const outcome = await apply(client, ctx, m);

    await client.query(
      `INSERT INTO client_mutations (id, branch_id, user_id, device_id, entity, entity_id, op, base_version, payload, result, error, client_created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
      [m.id, auth.branchId, auth.userId, deviceId, m.entity, m.entityId, m.op, m.baseVersion ?? null, JSON.stringify(m.payload),
       outcome.result, outcome.result === 'applied' ? null : outcome.error, m.clientCreatedAt]);

    if (outcome.result === 'applied') return { id: m.id, result: 'applied', row: outcome.row, rowEntity: outcome.rowEntity };
    if (outcome.result === 'conflict') return { id: m.id, result: 'conflict', error: outcome.error, row: outcome.row, rowEntity: outcome.rowEntity };
    return { id: m.id, result: 'rejected', error: outcome.error };
  });
}

/**
 * Applies a device's mutations in the order it made them. Each one is its own transaction and gets its own verdict,
 * so one bad mutation never blocks the rest, and the whole call is safe to repeat.
 */
export async function processPush(deps: PushDeps, auth: AuthContext, request: PushRequest): Promise<PushResponse> {
  const results: MutationResult[] = [];
  for (const mutation of request.mutations) results.push(await processOne(deps, auth, request.deviceId, mutation));
  // After every transaction committed, never before: the website must never re-read a change that was rolled back.
  const touchedPublic = request.mutations.some((m, i) => results[i]?.result === 'applied' && PUBLIC_ENTITIES.has(m.entity));
  if (touchedPublic) deps.onPublicChange?.();
  return { results };
}
