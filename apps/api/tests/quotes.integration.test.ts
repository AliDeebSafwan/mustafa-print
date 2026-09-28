import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const Q = '/api/v1/admin/quotes';

describe.skipIf(!hasTestDatabase)('quotes', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient, operator: ApiClient, otherAdmin: ApiClient;
  beforeAll(async () => {
    s = await startTestServer();
    const { ensureDefaultTemplates } = await import('../src/modules/messaging/default-templates');
    await ensureDefaultTemplates(s.pool);
    [admin, staff, operator, otherAdmin] = [await s.as('admin'), await s.as('staff'), await s.as('operator'), await s.as('otheradmin')];
  });
  afterAll(async () => { await s.close(); });

  const settings = async (data: Json) => {
    const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
    await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: current.row_version, data }),
    });
  };
  const newQuote = async (client: ApiClient, over: Json = {}) => {
    const customerId = await createCustomer(staff);
    return client.post(Q, {
      customer_id: customerId, valid_days: 14, notes: 'Includes design', internal_notes: 'Regular customer, good payer',
      items: [{ name: 'Flyers A5', quantity: '500', unit_price: '0.04' }, { name: 'Rollup banner', quantity: '2', unit_price: '12.5' }],
      ...over,
    });
  };
  const pub = {
    view: (code: string) => fetch(`${s.baseUrl}/api/v1/public/quotes/${code}`),
    accept: (code: string) => fetch(`${s.baseUrl}/api/v1/public/quotes/${code}/accept`, { method: 'POST' }),
    decline: (code: string, reason?: string) => fetch(`${s.baseUrl}/api/v1/public/quotes/${code}/decline`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reason ? { reason } : {}) }),
  };

  it('issues a numbered quote with exact totals and a customer link', async () => {
    const res = await newQuote(staff, { discount_total: '5' });
    expect(res.status).toBe(201);
    const q = await jsonOf<Json>(res);
    expect(q).toMatchObject({ status: 'sent', subtotal: '45.00', discount_total: '5.00', tax_total: '0.00', total: '40.00' });   // 20 + 25 - 5
    expect(q.link).toBe(`https://print.example.com/ar/quote/${q.public_code}`);
    const next = await jsonOf<Json>(await newQuote(staff));
    expect(Number(next.quote_number)).toBe(Number(q.quote_number) + 1);
  });

  it('the customer\'s link shows the offer but never the staff\'s internal notes', async () => {
    const q = await jsonOf<Json>(await newQuote(staff));
    const view = await jsonOf<Json>(await pub.view(q.public_code));
    expect(view).toMatchObject({ status: 'sent', total: '45.00', notes: 'Includes design', orderCode: null });
    expect(view.items).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain('Regular customer');
    expect((await pub.view('ZZZZZZZZZZZZ')).status).toBe(404);
  });

  it('accepting creates an order with the same items and prices, and tells the customer it was received', async () => {
    const q = await jsonOf<Json>(await newQuote(staff, { discount_total: '5' }));
    const accepted = await jsonOf<Json>(await pub.accept(q.public_code));
    const { rows: [order] } = await s.pool.query(
      `SELECT id, source, status, subtotal::text, discount_total::text, total::text, internal_notes FROM orders WHERE public_code = $1`, [accepted.orderCode]);
    expect(order).toMatchObject({ source: 'quote', status: 'received', subtotal: '45.00', discount_total: '5.00', total: '40.00' });
    expect(order.internal_notes).toBe(`Accepted quote #${q.quote_number}`);
    const { rows: items } = await s.pool.query(`SELECT name_snapshot, quantity::text, unit_price::text, line_total::text FROM order_items WHERE order_id = $1 ORDER BY sort_order`, [order.id]);
    expect(items).toEqual([
      { name_snapshot: 'Flyers A5', quantity: '500.000', unit_price: '0.0400', line_total: '20.00' },
      { name_snapshot: 'Rollup banner', quantity: '2.000', unit_price: '12.5000', line_total: '25.00' },
    ]);
    const { rows: msgs } = await s.pool.query(`SELECT template_key FROM notification_logs WHERE order_id = $1`, [order.id]);
    expect(msgs.map((m) => m.template_key)).toContain('order.received');

    expect(await jsonOf<Json>(await pub.view(q.public_code))).toMatchObject({ status: 'accepted', orderCode: accepted.orderCode });
    expect(await jsonOf<Json>(await admin.get(`${Q}/${q.id}`))).toMatchObject({ status: 'accepted', order_id: order.id });
  });

  it('keeps the agreed price even if the shop\'s tax changes after the quote was sent', async () => {
    await settings({ vat_enabled: true, vat_rate_percent: 10 });
    const q = await jsonOf<Json>(await newQuote(staff));
    expect(q).toMatchObject({ tax_total: '4.50', total: '49.50' });
    await settings({ vat_rate_percent: 20 });
    const accepted = await jsonOf<Json>(await pub.accept(q.public_code));
    const { rows: [order] } = await s.pool.query(`SELECT tax_total::text, total::text FROM orders WHERE public_code = $1`, [accepted.orderCode]);
    expect(order).toEqual({ tax_total: '4.50', total: '49.50' });
    await settings({ vat_enabled: false, vat_rate_percent: 0 });
  });

  it('a double tap or a second tab creates one order, not two', async () => {
    const q = await jsonOf<Json>(await newQuote(staff));
    const [a, b] = await Promise.all([pub.accept(q.public_code), pub.accept(q.public_code)]);
    const [first, second] = [await jsonOf<Json>(a), await jsonOf<Json>(b)];
    expect(first.orderCode).toBe(second.orderCode);
    expect((await jsonOf<Json>(await pub.accept(q.public_code))).orderCode).toBe(first.orderCode);
    const { rows } = await s.pool.query(`SELECT count(*)::int AS n FROM orders WHERE internal_notes = $1`, [`Accepted quote #${q.quote_number}`]);
    expect(rows[0].n).toBe(1);
  });

  describe('when it can no longer be accepted', () => {
    it('an expired quote shows as expired and refuses acceptance', async () => {
      const q = await jsonOf<Json>(await newQuote(staff));
      await s.pool.query(`UPDATE quotes SET valid_until = clock_timestamp() - interval '1 minute' WHERE id = $1`, [q.id]);
      expect(await jsonOf<Json>(await pub.view(q.public_code))).toMatchObject({ status: 'expired' });
      expect(await jsonOf<Json>(await pub.accept(q.public_code))).toMatchObject({ message: 'quote_expired' });
      expect((await pub.decline(q.public_code)).status).toBe(409);
    });

    it('a declined quote keeps the customer\'s reason and cannot be accepted afterwards', async () => {
      const q = await jsonOf<Json>(await newQuote(staff));
      expect((await pub.decline(q.public_code, 'Found it cheaper elsewhere')).status).toBe(204);
      expect(await jsonOf<Json>(await admin.get(`${Q}/${q.id}`))).toMatchObject({ status: 'declined', decline_reason: 'Found it cheaper elsewhere' });
      expect(await jsonOf<Json>(await pub.accept(q.public_code))).toMatchObject({ message: 'quote_declined' });
    });

    it('staff can withdraw a quote that is still open, once', async () => {
      const q = await jsonOf<Json>(await newQuote(staff));
      expect(await jsonOf<Json>(await staff.post(`${Q}/${q.id}/cancel`, {}))).toMatchObject({ status: 'cancelled' });
      expect((await staff.post(`${Q}/${q.id}/cancel`, {})).status).toBe(409);
      expect(await jsonOf<Json>(await pub.accept(q.public_code))).toMatchObject({ message: 'quote_cancelled' });
    });
  });

  describe('what staff may issue', () => {
    it('explains an impossible price instead of failing on a database rule', async () => {
      expect(await jsonOf<Json>(await newQuote(staff, { items: [{ name: 'x', quantity: '1', unit_price: '5', discount: '10' }] }))).toMatchObject({ message: 'negative_line' });
      expect(await jsonOf<Json>(await newQuote(admin, { discount_total: '1000' }))).toMatchObject({ message: 'discount_exceeds_subtotal' });
    });

    it('respects the shop\'s discount cap for staff, not for the owner', async () => {
      await settings({ max_discount_percent: 10 });
      expect(await jsonOf<Json>(await newQuote(staff, { discount_total: '20' }))).toMatchObject({ message: 'discount_too_large:10.00' });
      expect((await newQuote(admin, { discount_total: '20' })).status).toBe(201);
      await settings({ max_discount_percent: null });
    });

    it('needs permission, and never quotes a customer from another branch', async () => {
      expect((await newQuote(operator)).status).toBe(403);
      const foreign = await createCustomer(otherAdmin);
      expect((await staff.post(Q, { customer_id: foreign, items: [{ name: 'x', quantity: '1', unit_price: '1' }] })).status).toBe(404);
      const mine = await jsonOf<Json>(await newQuote(staff));
      expect((await otherAdmin.get(`${Q}/${mine.id}`)).status).toBe(404);
    });
  });
});
