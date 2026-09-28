/**
 * Integration test against a REAL PostgreSQL (skipped unless TEST_DATABASE_URL is set). It creates and drops its own
 * database, see tests/helpers/test-db.ts.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePublicCode } from '@mpe/shared';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/test-db';
import { enqueueOrderNotification } from '../src/modules/messaging/enqueue';
import { claimBatch, runOnce } from '../src/modules/messaging/outbox-worker';
import type { Channel, ChannelProvider, SendResult } from '../src/modules/messaging/types';

const log = pino({ level: 'silent' });

function fakeProvider(results: SendResult[]): ChannelProvider & { calls: number } {
  const p = { channel: 'whatsapp' as Channel, name: 'fake', calls: 0, async send() { const r = results[Math.min(p.calls, results.length - 1)]!; p.calls++; return r; } };
  return p;
}

describe.skipIf(!hasTestDatabase)('messaging against PostgreSQL', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  const branchId = randomUUID();
  const customerId = randomUUID();
  const orderId = randomUUID();
  let templateId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    pool = testDb.pool;
    await pool.query(`INSERT INTO branches (id, code, name_ar, name_en) VALUES ($1, $2, 'فرع الاختبار', 'Test Branch')`, [branchId, `T${branchId.slice(0, 8)}`]);
    await pool.query(
      `INSERT INTO customers (id, branch_id, full_name, phone_e164, locale, whatsapp_opt_in, preferred_channel) VALUES ($1,$2,'علي','+96170000123','ar',true,'whatsapp')`,
      [customerId, branchId],
    );
    await pool.query(`INSERT INTO orders (id, branch_id, public_code, customer_id) VALUES ($1,$2,$3,$4)`, [orderId, branchId, generatePublicCode(), customerId]);
    const t = await pool.query<{ id: string }>(
      `INSERT INTO notification_templates (branch_id, template_key, channel, locale, body, variables, provider_template_name, provider_template_language)
       VALUES ($1,'order.received','whatsapp','ar','مرحباً {{customer_name}}، طلبك رقم {{order_id}}: {{tracking_url}}', '{customer_name,order_id,tracking_url}', 'mpe_order_received', 'ar') RETURNING id`,
      [branchId],
    );
    templateId = t.rows[0]!.id;
    await pool.query(
      `INSERT INTO notification_templates (branch_id, template_key, channel, locale, body, variables) VALUES ($1,'order.out_for_delivery','whatsapp','ar','{{does_not_exist}}','{does_not_exist}')`,
      [branchId],
    );
  });

  afterAll(async () => { await testDb.drop(); });

  it('enqueues once per (order, template, channel) and renders the tracking link', async () => {
    const first = await enqueueOrderNotification(pool, orderId, 'received', { publicWebUrl: 'https://print.example.com/' });
    expect(first.queued).toBe(true);
    const again = await enqueueOrderNotification(pool, orderId, 'received', { publicWebUrl: 'https://print.example.com/' });
    expect(again).toMatchObject({ queued: false, reason: 'duplicate' });

    const { rows } = await pool.query(`SELECT status, body, recipient, template_id FROM notification_logs WHERE order_id = $1`, [orderId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('queued');
    expect(rows[0].recipient).toBe('+96170000123');
    expect(rows[0].template_id).toBe(templateId);
    expect(rows[0].body).toMatch(/^مرحباً علي، طلبك رقم 1: https:\/\/print\.example\.com\/ar\/track\/[0-9A-Z]{12}$/);
  });

  it('does nothing for statuses without a template and for customers without consent', async () => {
    expect(await enqueueOrderNotification(pool, orderId, 'in_design', { publicWebUrl: 'https://x' })).toMatchObject({ queued: false, reason: 'no_template_for_status' });
    await pool.query('UPDATE customers SET whatsapp_opt_in = false WHERE id = $1', [customerId]);
    expect(await enqueueOrderNotification(pool, orderId, 'printing', { publicWebUrl: 'https://x' })).toMatchObject({ queued: false, reason: 'no_consented_channel' });
    await pool.query('UPDATE customers SET whatsapp_opt_in = true WHERE id = $1', [customerId]);
  });

  it('retries a transient failure with backoff, then delivers', async () => {
    const provider = fakeProvider([
      { ok: false, provider: 'fake', retryable: true, code: '503', message: 'try later' },
      { ok: true, provider: 'fake', providerMessageId: 'wamid.OK' },
    ]);
    const deps = { pool, providers: new Map<Channel, ChannelProvider>([['whatsapp', provider]]), log, intervalMs: 250, batchSize: 10 };

    expect(await runOnce(deps)).toBe(1);
    let row = (await pool.query(`SELECT status, attempts, error_code, next_attempt_at > clock_timestamp() AS in_future, locked_at FROM notification_logs WHERE order_id = $1`, [orderId])).rows[0];
    expect(row).toMatchObject({ status: 'queued', attempts: 1, error_code: '503', in_future: true, locked_at: null });
    expect(await runOnce(deps)).toBe(0); // backoff: not due yet

    await pool.query(`UPDATE notification_logs SET next_attempt_at = clock_timestamp() WHERE order_id = $1`, [orderId]);
    expect(await runOnce(deps)).toBe(1);
    row = (await pool.query(`SELECT status, attempts, provider_message_id, sent_at IS NOT NULL AS sent FROM notification_logs WHERE order_id = $1`, [orderId])).rows[0];
    expect(row).toMatchObject({ status: 'sent', attempts: 2, provider_message_id: 'wamid.OK', sent: true });
  });

  it('marks permanent failures as failed without retrying', async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO notification_logs (id, branch_id, channel, locale, recipient, body) VALUES ($1,$2,'whatsapp','ar','+96170000123','x')`, [id, branchId]);
    const provider = fakeProvider([{ ok: false, provider: 'fake', retryable: false, code: '131030', message: 'not allowed' }]);
    await runOnce({ pool, providers: new Map([['whatsapp', provider]]), log, intervalMs: 250, batchSize: 10 });
    const row = (await pool.query(`SELECT status, error_code, failed_at IS NOT NULL AS failed FROM notification_logs WHERE id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ status: 'failed', error_code: '131030', failed: true });
    expect(provider.calls).toBe(1);
  });

  it('SKIP LOCKED: concurrent workers never claim the same row', async () => {
    const ids: string[] = Array.from({ length: 6 }, () => randomUUID());
    for (const id of ids) await pool.query(`INSERT INTO notification_logs (id, branch_id, channel, locale, recipient, body) VALUES ($1,$2,'email','ar','a@b.c','x')`, [id, branchId]);
    const [a, b] = await Promise.all([claimBatch(pool, 3), claimBatch(pool, 3)]);
    const claimed = [...a, ...b].map((r) => r.id).filter((id) => ids.includes(id));
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBe(6);
  });

  it('recovers rows stuck in "sending" after a worker crash', async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO notification_logs (id, branch_id, channel, locale, recipient, body, status, locked_at, attempts) VALUES ($1,$2,'email','ar','a@b.c','x','sending', clock_timestamp() - interval '10 minutes', 1)`, [id, branchId]);
    const claimed = await claimBatch(pool, 50);
    expect(claimed.map((r) => r.id)).toContain(id);
    expect(claimed.find((r) => r.id === id)!.attempts).toBe(2);
  });

  it('records a visible failed log when a template variable has no value', async () => {
    const res = await enqueueOrderNotification(pool, orderId, 'out_for_delivery', { publicWebUrl: 'https://x' });
    expect(res).toMatchObject({ queued: false, reason: 'render_failed' });
    const row = (await pool.query(`SELECT status, error_code, dedupe_key FROM notification_logs WHERE id = $1`, [res.logId])).rows[0];
    expect(row).toMatchObject({ status: 'failed', error_code: 'TEMPLATE_RENDER', dedupe_key: null });
  });
});
