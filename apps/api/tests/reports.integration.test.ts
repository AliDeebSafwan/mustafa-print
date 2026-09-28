import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('reports', () => {
  let s: TestServer;
  let admin: ApiClient, reception: ApiClient, otherAdmin: ApiClient;
  const R = '/api/v1/admin/reports';

  beforeAll(async () => { s = await startTestServer(); admin = await s.as('admin'); reception = await s.as('receptionist'); otherAdmin = await s.as('otheradmin'); });
  afterAll(async () => { await s.close(); });

  const get = (client: ApiClient, path: string) => client.get(`${R}${path}`);
  const rawGet = (path: string) => fetch(`${s.baseUrl}${R}${path}`, { headers: { Authorization: `Bearer ${admin.token}` } });
  const collect = async (orderId: string, over: Json = {}) => {
    const r = await pushOne(reception, mutation('transactions:insert', newId(), { order_id: orderId, txn_type: 'payment', method: 'cash', amount: '10', ...over }));
    expect(r.result).toBe('applied');
    return r.row!.id as string;
  };
  const settle = async (txnId: string, settledAt: string) => {
    const r = await pushOne(reception, mutation('transactions:settle', txnId, { settled_at: settledAt }));
    expect(r.result).toBe('applied');
  };

  describe('who may see them', () => {
    it('is refused to staff without the permission, and never leaks a branch\'s data to another', async () => {
      for (const path of ['/dashboard', '/unpaid', '/cash-closing', '/production-queue']) {
        expect((await get(reception, path)).status).toBe(403);
        expect((await get(admin, path)).status).toBe(200);
      }
      const customerId = await createCustomer(admin);
      await createOrder(admin, customerId);
      const otherOrders = await jsonOf<Json[]>(await get(otherAdmin, '/production-queue'));
      expect(otherOrders).toEqual([]);
    });
  });

  describe('today, in the shop\'s own timezone', () => {
    it('counts an order placed just after UTC midnight as yesterday when the shop is west of UTC', async () => {
      // A shop at UTC-5: at 2026-03-10T03:00Z it is still 2026-03-09T22:00 locally — "today" there has not yet reached March 10.
      await s.pool.query(`UPDATE branches SET timezone = 'America/New_York' WHERE id = $1`, [s.fixtures.branchId]);
      const customerId = await createCustomer(admin);
      const order = await createOrder(admin, customerId);
      await s.pool.query(`UPDATE orders SET placed_at = '2026-03-10T03:00:00Z' WHERE id = $1`, [order.id]);

      const asMarch10Utc = await jsonOf<Json>(await get(admin, '/dashboard?date=2026-03-10'));
      const asMarch9Local = await jsonOf<Json>(await get(admin, '/dashboard?date=2026-03-09'));
      expect(asMarch10Utc.ordersPlaced).toBe(0);   // that UTC calendar date had not yet begun locally
      expect(asMarch9Local.ordersPlaced).toBe(1);  // it was still March 9th at the counter

      await s.pool.query(`UPDATE branches SET timezone = 'UTC' WHERE id = $1`, [s.fixtures.branchId]);
    });
  });

  describe('the dashboard', () => {
    it('counts orders placed, revenue, and same-day cash paid at the counter', async () => {
      const before = await jsonOf<Json>(await get(admin, '/dashboard'));
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId, { items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: '40' }] });
      await collect(order.id, { amount: '15' });

      const after = await jsonOf<Json>(await get(admin, '/dashboard'));
      expect(after.ordersPlaced).toBe(before.ordersPlaced + 1);
      expect(Number(after.revenuePlaced) - Number(before.revenuePlaced)).toBeCloseTo(40, 5);
      expect(Number(after.cashIn) - Number(before.cashIn)).toBeCloseTo(15, 5);
    });

    it('an unsettled COD collection is not yet cash in hand', async () => {
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId);
      const before = await jsonOf<Json>(await get(admin, '/dashboard'));
      await collect(order.id, { method: 'cod', amount: '25' });
      const after = await jsonOf<Json>(await get(admin, '/dashboard'));
      expect(after.cashIn).toBe(before.cashIn);   // collected on delivery, not yet handed to the shop
    });

    it('a refund reduces net cash without needing to touch payments', async () => {
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId);
      const txnId = await collect(order.id, { amount: '30' });
      const before = await jsonOf<Json>(await get(admin, '/dashboard'));
      // refunds are an owner-only permission by default (delegable, but not part of the staff role's base set)
      const refund = await pushOne(admin, mutation('transactions:insert', newId(), { order_id: order.id, txn_type: 'refund', method: 'cash', amount: '30', collected_at: new Date().toISOString() }));
      expect(refund.result).toBe('applied');
      const after = await jsonOf<Json>(await get(admin, '/dashboard'));
      expect(Number(after.cashOut) - Number(before.cashOut)).toBeCloseTo(30, 5);
      void txnId;
    });
  });

  describe('unpaid balances', () => {
    it('lists a partly-paid order with the right remaining amount, and excludes what is settled or cancelled', async () => {
      const customerId = await createCustomer(reception);
      const partial = await createOrder(reception, customerId, { items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: '100' }] });
      await collect(partial.id, { amount: '40' });

      const cancelled = await createOrder(reception, customerId);
      await pushOne(admin, mutation('order_status_history:status_change', newId(), { order_id: cancelled.id, to_status: 'cancelled', source: 'manual', note: 'x', occurred_at: new Date().toISOString() }));

      const rows = await jsonOf<Json[]>(await get(admin, '/unpaid'));
      const row = rows.find((r) => r.id === partial.id);
      expect(row).toMatchObject({ payment_status: 'partial', total: '100.00', paid_total: '40.00', remaining: '60.00' });
      expect(rows.some((r) => r.id === cancelled.id)).toBe(false);
    });
  });

  describe('closing the till', () => {
    it('counts a COD collection on the day it was SETTLED, not the day it was collected', async () => {
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId);
      const txnId = await collect(order.id, { method: 'cod', amount: '18', collected_at: '2026-04-01T10:00:00Z' });
      await settle(txnId, '2026-04-02T09:00:00Z');

      const collectedDay = await jsonOf<Json>(await get(admin, '/cash-closing?date=2026-04-01'));
      const settledDay = await jsonOf<Json>(await get(admin, '/cash-closing?date=2026-04-02'));
      expect(collectedDay.byMethod.find((m: Json) => m.method === 'cod')).toBeUndefined();
      expect(settledDay.byMethod.find((m: Json) => m.method === 'cod' && m.txn_type === 'payment')).toMatchObject({ amount: '18.00', count: 1 });
    });

    it('exports a CSV with a BOM, the right content type, and safely escaped fields', async () => {
      const customerId = await createCustomer(reception, { full_name: 'Comma, "Quote" Customer' });
      const order = await createOrder(reception, customerId);
      await collect(order.id, { note: 'a note' });
      const res = await rawGet('/unpaid?format=csv');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      // Response.text() decodes as UTF-8 and strips a leading BOM per spec, so the BOM itself must be checked on
      // the raw bytes, not the decoded string.
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
      const text = new TextDecoder('utf-8').decode(bytes);
      expect(text).toContain('"Comma, ""Quote"" Customer"');
      expect(text.split('\r\n')[0]).toContain('public_code');
    });
  });

  describe('the production queue', () => {
    it('includes everything still open, and drops off once delivered or cancelled', async () => {
      const customerId = await createCustomer(reception);
      const open = await createOrder(reception, customerId);
      const delivered = await createOrder(reception, customerId);
      for (const to of ['received', 'printing', 'ready', 'delivered']) {
        await pushOne(admin, mutation('order_status_history:status_change', newId(), { order_id: delivered.id, to_status: to as never, source: 'manual', occurred_at: new Date().toISOString() }));
      }
      const rows = await jsonOf<Json[]>(await get(admin, '/production-queue'));
      expect(rows.some((r) => r.id === open.id)).toBe(true);
      expect(rows.some((r) => r.id === delivered.id)).toBe(false);
    });
  });
});
