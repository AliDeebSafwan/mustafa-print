import { MUTATION_PAYLOADS, formatIssues, uuidv7, type MutationInput, type MutationKind } from '@mpe/shared'
import type { OutboxItem } from '../db'

/** The payload could never be accepted by the server, so it is not queued at all. */
export class InvalidMutationError extends Error {
  readonly issues: string
  constructor(kind: string, issues: string) { super(`Invalid ${kind}: ${issues}`); this.name = 'InvalidMutationError'; this.issues = issues }
}

let lastMs = 0
/**
 * Strictly increasing on this device, even for two writes in the same millisecond. The server applies mutations in this
 * order, and a customer must exist before their order does.
 */
export function nextTimestamp(now: number = Date.now()): string {
  lastMs = Math.max(now, lastMs + 1)
  return new Date(lastMs).toISOString()
}

/**
 * Every offline write = optimistic local change + one outbox entry, in a single transaction (all or nothing).
 * The payload is typed by, and validated against, the contract in @mpe/shared: the schema the server itself uses.
 * Anything the server is certain to reject is refused here, while the person can still fix it.
 */
export function newMutation<K extends MutationKind>(kind: K, entityId: string, payload: MutationInput<K>, baseVersion: number | null = null): OutboxItem {
  const checked = MUTATION_PAYLOADS[kind].safeParse(payload)
  if (!checked.success) throw new InvalidMutationError(kind, formatIssues(checked.error))
  const [entity, op] = kind.split(':') as [OutboxItem['entity'], OutboxItem['op']]
  return { id: uuidv7(), entity, entityId, op, baseVersion, payload: payload as Record<string, unknown>, clientCreatedAt: nextTimestamp(), attempts: 0 }
}
