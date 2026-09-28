import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, pushOne } from './helpers/sync-client';
import { startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

describe.skipIf(!hasTestDatabase)('manual messaging', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient;

  beforeAll(async () => { s = await startTestServer(); admin = await s.as('admin'); staff = await s.as('staff'); });
  afterAll(async () => { await s.close(); });

  const send = (client: ApiClient, orderId: string, over: Record<string, unknown> = {}) =>
    pushOne(client, mutation('notification_logs:manual_send', newId(), { order_id: orderId, channel: 'whatsapp', body: 'your order is ready for pickup', ...over }));

  it('queues a message to a channel the customer actually consented to', async () => {
    const customerId = await createCustomer(staff);   // default fixture: whatsapp_opt_in true
    const { id: orderId } = await createOrder(staff, customerId);
    const res = await send(staff, orderId);
    expect(res).toMatchObject({ result: 'applied', row: { channel: 'whatsapp', trigger: 'manual', status: 'queued', body: 'your order is ready for pickup' } });

    const { rows } = await s.pool.query('SELECT channel, trigger, created_by, dedupe_key FROM notification_logs WHERE order_id = $1', [orderId]);
    expect(rows).toEqual([{ channel: 'whatsapp', trigger: 'manual', created_by: expect.any(String), dedupe_key: null }]);
  });

  it('is refused for a channel the customer never consented to, and nothing is queued', async () => {
    const customerId = await createCustomer(staff, { whatsapp_opt_in: false, sms_opt_in: false, email_opt_in: false, consent_source: undefined });
    const { id: orderId } = await createOrder(staff, customerId);
    const res = await send(staff, orderId);
    expect(res).toMatchObject({ result: 'rejected', error: expect.stringContaining('no_consented_channel') });

    const { rows } = await s.pool.query('SELECT count(*)::int AS n FROM notification_logs WHERE order_id = $1', [orderId]);
    expect(rows[0].n).toBe(0);
  });

  it('re-checks consent on the server: a device that believes stale consent cannot send anyway', async () => {
    // opted in, then the customer withdraws consent — the DEVICE never learns this until it next syncs, but the
    // server must refuse regardless of what the offline mutation still believes.
    const customerId = await createCustomer(staff);
    const { id: orderId } = await createOrder(staff, customerId);
    const withdraw = await pushOne(staff, mutation('customers:update', customerId, { changes: { whatsapp_opt_in: false }, base: { whatsapp_opt_in: true } }));
    expect(withdraw.result).toBe('applied');
    expect(await send(staff, orderId)).toMatchObject({ result: 'rejected', error: expect.stringContaining('no_consented_channel') });
  });

  it('is idempotent: retrying the exact same offline mutation never sends the message twice', async () => {
    const customerId = await createCustomer(staff);
    const { id: orderId } = await createOrder(staff, customerId);
    const m = mutation('notification_logs:manual_send', newId(), { order_id: orderId, channel: 'whatsapp', body: 'hello again' });
    expect((await pushOne(staff, m)).result).toBe('applied');
    expect((await pushOne(staff, m)).result).toBe('duplicate');

    const { rows } = await s.pool.query('SELECT count(*)::int AS n FROM notification_logs WHERE order_id = $1', [orderId]);
    expect(rows[0].n).toBe(1);
  });

  it('sits in the same queue the worker already drains, ready to send', async () => {
    const customerId = await createCustomer(staff);
    const { id: orderId } = await createOrder(staff, customerId);
    await send(staff, orderId);
    const { rows } = await s.pool.query(`SELECT status, next_attempt_at <= clock_timestamp() AS due FROM notification_logs WHERE order_id = $1`, [orderId]);
    expect(rows[0]).toEqual({ status: 'queued', due: true });
  });

  it('requires the notifications:send permission', async () => {
    const operator = await s.as('operator');   // machine_operator: no messaging permission at all
    const customerId = await createCustomer(admin);
    const { id: orderId } = await createOrder(admin, customerId);
    const res = await send(operator, orderId);
    expect(res.result).toBe('rejected');
    expect(res.error).toContain('forbidden');
  });
});
