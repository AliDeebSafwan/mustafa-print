import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { Channel, ChannelProvider, OutboundMessage, Locale } from './types';

/**
 * Postgres-backed outbox: notification_logs IS the queue (FOR UPDATE SKIP LOCKED), so the $30 VPS needs no Redis.
 * Delivery is at-least-once: a crash between "provider accepted" and "row marked sent" can re-send after the lease
 * expires (5 min). That is the usual trade-off; the provider message id is stored to reconcile via webhooks.
 */
export interface ClaimedMessage {
  id: string;
  branch_id: string;
  channel: Channel;
  locale: Locale;
  recipient: string;
  subject: string | null;
  body: string;
  variables: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  provider_template_name: string | null;
  provider_template_language: string | null;
  template_variables: string[] | null;
}

export const LEASE_MINUTES = 5;

/** attempt = number of attempts already made (1-based). 30s, 1m, 2m, 4m ... capped at 1h. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}

export async function claimBatch(pool: Pool, limit: number): Promise<ClaimedMessage[]> {
  const { rows } = await pool.query<ClaimedMessage>(
    `WITH picked AS (
       SELECT id FROM notification_logs
        WHERE deleted_at IS NULL
          AND ((status = 'queued'  AND next_attempt_at <= clock_timestamp())
            OR (status = 'sending' AND locked_at < clock_timestamp() - make_interval(mins => $2)))
        ORDER BY next_attempt_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE notification_logs n
          SET status = 'sending', locked_at = clock_timestamp(), attempts = n.attempts + 1
         FROM picked WHERE n.id = picked.id
       RETURNING n.*
     )
     SELECT c.id, c.branch_id, c.channel, c.locale, c.recipient, c.subject, c.body, c.variables, c.attempts, c.max_attempts,
            t.provider_template_name, t.provider_template_language, t.variables AS template_variables
       FROM claimed c
       LEFT JOIN notification_templates t ON t.id = c.template_id AND t.branch_id = c.branch_id`,
    [limit, LEASE_MINUTES],
  );
  return rows;
}

export function toOutbound(row: ClaimedMessage): OutboundMessage {
  const hasTemplate = row.channel === 'whatsapp' && row.provider_template_name && row.provider_template_language;
  return {
    logId: row.id,
    channel: row.channel,
    to: row.recipient,
    locale: row.locale,
    subject: row.subject,
    body: row.body,
    template: hasTemplate
      ? {
          name: row.provider_template_name!,
          language: row.provider_template_language!,
          params: (row.template_variables ?? []).map((name) => String(row.variables?.[name] ?? '')),
        }
      : null,
  };
}

export interface WorkerDeps { pool: Pool; providers: Map<Channel, ChannelProvider>; log: Logger; intervalMs: number; batchSize: number }

export async function processMessage(deps: WorkerDeps, row: ClaimedMessage): Promise<'sent' | 'retry' | 'failed'> {
  const { pool, providers, log } = deps;
  const provider = providers.get(row.channel);
  const result = provider
    ? await provider.send(toOutbound(row)).catch((err: unknown) => ({
        ok: false as const, provider: provider.name, retryable: true, code: 'EXCEPTION', message: err instanceof Error ? err.message : String(err),
      }))
    : ({ ok: false as const, provider: 'none', retryable: false, code: 'NO_PROVIDER', message: `No provider for ${row.channel}` });

  if (result.ok) {
    await pool.query(
      `UPDATE notification_logs
          SET status = 'sent', sent_at = clock_timestamp(), locked_at = NULL, provider = $2, provider_message_id = $3,
              error_code = NULL, error_message = NULL
        WHERE id = $1`,
      [row.id, result.provider, result.providerMessageId],
    );
    log.info({ id: row.id, channel: row.channel, provider: result.provider }, 'message sent');
    return 'sent';
  }

  const exhausted = !result.retryable || row.attempts >= row.max_attempts;
  if (exhausted) {
    await pool.query(
      `UPDATE notification_logs
          SET status = 'failed', failed_at = clock_timestamp(), locked_at = NULL, provider = $2, error_code = $3, error_message = $4
        WHERE id = $1`,
      [row.id, result.provider, result.code ?? null, result.message],
    );
    log.warn({ id: row.id, channel: row.channel, code: result.code, message: result.message }, 'message failed permanently');
    return 'failed';
  }

  await pool.query(
    `UPDATE notification_logs
        SET status = 'queued', locked_at = NULL, provider = $2, error_code = $3, error_message = $4,
            next_attempt_at = clock_timestamp() + make_interval(secs => $5)
      WHERE id = $1`,
    [row.id, result.provider, result.code ?? null, result.message, backoffMs(row.attempts) / 1000],
  );
  log.warn({ id: row.id, attempt: row.attempts, code: result.code }, 'message failed, will retry');
  return 'retry';
}

export async function runOnce(deps: WorkerDeps): Promise<number> {
  const batch = await claimBatch(deps.pool, deps.batchSize);
  for (const row of batch) await processMessage(deps, row);
  return batch.length;
}

export interface WorkerHandle { stop(): Promise<void> }

export function startOutboxWorker(deps: WorkerDeps): WorkerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    try {
      // Drain: keep going while there is work, then sleep.
      while (!stopped && (await runOnce(deps)) === deps.batchSize) { /* loop */ }
    } catch (err) {
      deps.log.error({ err }, 'outbox tick failed');
    }
    if (!stopped) timer = setTimeout(() => { running = tick(); }, deps.intervalMs);
  };
  running = tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
