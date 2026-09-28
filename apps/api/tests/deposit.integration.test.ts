import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, mutation, newId, orderPayload, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('the deposit rule', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient;

  beforeAll(async () => { s = await startTestServer(); admin = await s.as('admin'); staff = await s.as('staff'); });
  afterAll(async () => { await setDeposit(0, null); await s.close(); });

  const setDeposit = async (percent: number, threshold: number | null) => {
    const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
    const res = await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: current.row_version, data: { deposit_percent: percent, deposit_threshold: threshold } }),
    });
    expect(res.status).toBe(200);
  };
  const newOrder = async (unitPrice: string, over: Json = {}) => {
    const customerId = await createCustomer(staff);
    const id = newId();
    const r = await pushOne(staff, mutation('orders:insert', id, orderPayload(customerId, {
      items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: unitPrice }], ...over,
    })));
    expect(r.result).toBe('applied');
    return r.row!.id as string;
  };
  const pay = async (orderId: string, amount: string) => {
    const r = await pushOne(staff, mutation('transactions:insert', newId(), { order_id: orderId, txn_type: 'payment', method: 'cash', amount }));
    expect(r.result).toBe('applied');
  };
  const toPrinting = (client: ApiClient, orderId: string, note?: string) =>
    pushOne(client, mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: 'printing', source: 'manual', note, occurred_at: new Date().toISOString() }));

  it('is off by default: printing needs no deposit at all', async () => {
    const orderId = await newOrder('100');
    expect(await toPrinting(staff, orderId)).toMatchObject({ result: 'applied' });
  });

  it('blocks printing until the exact required amount is paid, then allows it', async () => {
    await setDeposit(30, null);
    const orderId = await newOrder('100');
    expect(await toPrinting(staff, orderId)).toMatchObject({ result: 'conflict', error: expect.stringContaining('30.00') });

    await pay(orderId, '29.99');
    expect(await toPrinting(staff, orderId)).toMatchObject({ result: 'conflict' });

    await pay(orderId, '0.01');   // now exactly 30.00 paid
    expect(await toPrinting(staff, orderId)).toMatchObject({ result: 'applied', row: { status: 'printing' } });
  });

  it('rounds to the cent for a total that does not divide evenly', async () => {
    await setDeposit(30, null);
    const orderId = await newOrder('33.33');
    const res = await toPrinting(staff, orderId);
    expect(res).toMatchObject({ result: 'conflict', error: expect.stringContaining('10.00') });   // 33.33 * 0.30 = 9.999 -> 10.00
  });

  it('only applies to orders at or above the threshold', async () => {
    await setDeposit(50, 100);
    const small = await newOrder('80');
    const big = await newOrder('100');
    expect(await toPrinting(staff, small)).toMatchObject({ result: 'applied' });     // below the threshold: no deposit needed
    expect(await toPrinting(staff, big)).toMatchObject({ result: 'conflict', error: expect.stringContaining('50.00') });
  });

  describe('the admin override', () => {
    it('is refused to staff, who only see that a deposit is owed', async () => {
      await setDeposit(50, null);
      const orderId = await newOrder('100');
      const res = await toPrinting(staff, orderId, 'staff cannot override this, even with a reason');
      expect(res).toMatchObject({ result: 'conflict' });
    });

    it('requires a reason, and records it in the audit log once given', async () => {
      await setDeposit(50, null);
      const orderId = await newOrder('100');
      const noReason = await toPrinting(admin, orderId);
      expect(noReason).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });

      const withReason = await toPrinting(admin, orderId, 'customer is a long-standing regular, allowed by the owner');
      expect(withReason).toMatchObject({ result: 'applied', row: { status: 'printing' } });

      const log = await jsonOf<Json[]>(await admin.get('/api/v1/admin/team/audit-log'));
      const entry = log.find((e) => e.action === 'order.deposit_overridden' && e.target_id === orderId);
      expect(entry).toMatchObject({ details: { required: '50.00', reason: 'customer is a long-standing regular, allowed by the owner' } });
    });

    it('replaying the same status change never re-checks the deposit or logs a second override', async () => {
      await setDeposit(50, null);
      const orderId = await newOrder('100');
      const change = mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: 'printing', source: 'manual', note: 'owner approved', occurred_at: new Date().toISOString() });
      expect((await pushOne(admin, change)).result).toBe('applied');
      expect((await pushOne(admin, change)).result).toBe('duplicate');

      const before = await jsonOf<Json[]>(await admin.get('/api/v1/admin/team/audit-log'));
      const count = before.filter((e) => e.action === 'order.deposit_overridden' && e.target_id === orderId).length;
      expect(count).toBe(1);
    });
  });
});
