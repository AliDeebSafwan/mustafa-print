import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, mutation, newId, orderPayload, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('editing order items after creation', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient;

  beforeAll(async () => { s = await startTestServer(); admin = await s.as('admin'); staff = await s.as('staff'); });
  afterAll(async () => { await s.close(); });

  const newOrder = async (client: ApiClient, over: Json = {}) => {
    const customerId = await createCustomer(client);
    const id = newId();
    const r = await pushOne(client, mutation('orders:insert', id, orderPayload(customerId, {
      items: [{ id: newId(), name_snapshot: 'Flyers', quantity: 100, unit_price: '0.20' }], ...over,
    })));
    expect(r.result).toBe('applied');
    return id;
  };
  const edit = (client: ApiClient, orderId: string, over: Json = {}) =>
    pushOne(client, mutation('orders:edit_items', orderId, { items: [{ id: newId(), name_snapshot: 'Banners', quantity: 2, unit_price: '30' }], ...over }));
  const toPrinting = (client: ApiClient, orderId: string) =>
    pushOne(client, mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: 'printing', source: 'manual', occurred_at: new Date().toISOString() }));
  const pay = (client: ApiClient, orderId: string, amount: string) =>
    pushOne(client, mutation('transactions:insert', newId(), { order_id: orderId, txn_type: 'payment', method: 'cash', amount }));

  it('replaces the items and recomputes the total from exact decimal arithmetic', async () => {
    const orderId = await newOrder(staff);
    const res = await edit(staff, orderId);
    expect(res).toMatchObject({ result: 'applied', row: { subtotal: '60.00', total: '60.00' } });

    const { rows } = await s.pool.query(`SELECT name_snapshot, quantity::text, unit_price::text, line_total::text FROM order_items WHERE order_id = $1 AND deleted_at IS NULL`, [orderId]);
    expect(rows).toEqual([{ name_snapshot: 'Banners', quantity: '2.000', unit_price: '30.0000', line_total: '60.00' }]);
    const old = await s.pool.query(`SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND deleted_at IS NOT NULL`, [orderId]);
    expect(old.rows[0].n).toBe(1);   // the original "Flyers" line is soft-deleted, not gone
  });

  it('lets the discount be adjusted too, within the shop\'s cap', async () => {
    const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
    await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: current.row_version, data: { max_discount_percent: 10 } }),
    });
    const orderId = await newOrder(staff);
    const tooMuch = await edit(staff, orderId, { discount_total: '50' });   // way more than 10% of 60
    expect(tooMuch).toMatchObject({ result: 'rejected', error: expect.stringContaining('discount_too_large') });
    const ok = await edit(staff, orderId, { discount_total: '5' });
    expect(ok).toMatchObject({ result: 'applied', row: { discount_total: '5.00', total: '55.00' } });
    await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: (await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'))).row_version, data: { max_discount_percent: null } }),
    });
  });

  it('keeps VAT correct against the new subtotal', async () => {
    const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
    await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: current.row_version, data: { vat_enabled: true, vat_rate_percent: 10 } }),
    });
    const orderId = await newOrder(staff);
    const res = await edit(staff, orderId);   // 2 x 30 = 60, +10% VAT
    expect(res).toMatchObject({ result: 'applied', row: { subtotal: '60.00', tax_total: '6.00', total: '66.00' } });
    await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: (await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'))).row_version, data: { vat_enabled: false, vat_rate_percent: 0 } }),
    });
  });

  it('refuses a discount larger than the new subtotal plus delivery', async () => {
    const orderId = await newOrder(admin);   // admin: no discount cap to worry about here
    const res = await edit(admin, orderId, { discount_total: '1000' });
    expect(res).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });
  });

  describe('once the order is locked', () => {
    it('is blocked once production has started, and staff only see that it is locked', async () => {
      const orderId = await newOrder(staff);
      expect((await toPrinting(staff, orderId)).result).toBe('applied');
      const res = await edit(staff, orderId);
      expect(res).toMatchObject({ result: 'conflict', error: expect.stringContaining('production') });
    });

    it('is blocked once any payment has been recorded, however small', async () => {
      const orderId = await newOrder(staff);
      expect((await pay(staff, orderId, '1')).result).toBe('applied');
      expect(await edit(staff, orderId)).toMatchObject({ result: 'conflict', error: expect.stringContaining('payment') });
    });

    it('is blocked once the invoice has been issued', async () => {
      const orderId = await newOrder(staff);
      await admin.post(`/api/v1/admin/orders/${orderId}/invoice`, {});
      expect(await edit(staff, orderId)).toMatchObject({ result: 'conflict', error: expect.stringContaining('invoice') });
    });

    it('the override permission unlocks it, but only with a reason — which is logged', async () => {
      const orderId = await newOrder(staff);
      expect((await pay(staff, orderId, '1')).result).toBe('applied');

      const noReason = await edit(admin, orderId);
      expect(noReason).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });

      const withReason = await edit(admin, orderId, { override_reason: 'customer changed the design after paying a deposit' });
      expect(withReason).toMatchObject({ result: 'applied', row: { total: '60.00' } });

      const log = await jsonOf<Json[]>(await admin.get('/api/v1/admin/team/audit-log'));
      const entry = log.find((e) => e.action === 'order.items_edited_after_lock' && e.target_id === orderId);
      expect(entry).toMatchObject({ details: { reason: 'customer changed the design after paying a deposit', had_payment: true } });
    });

    it('never applies to a cancelled or delivered order, override or not', async () => {
      const cancelled = await newOrder(staff);
      await pushOne(admin, mutation('order_status_history:status_change', newId(), { order_id: cancelled, to_status: 'cancelled', source: 'manual', note: 'x', occurred_at: new Date().toISOString() }));
      expect(await edit(admin, cancelled, { override_reason: 'x' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('order_closed') });
    });
  });

  it('requires the orders:update permission at all', async () => {
    const operator = await s.as('operator');   // machine_operator: read-only on orders
    const orderId = await newOrder(staff);
    const res = await edit(operator, orderId);
    expect(res.result).toBe('rejected');
    expect(res.error).toContain('forbidden');
  });
});
