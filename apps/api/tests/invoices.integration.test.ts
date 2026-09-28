import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, orderPayload, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('VAT and invoices', () => {
  let s: TestServer;
  let admin: ApiClient, reception: ApiClient, otherAdmin: ApiClient;

  beforeAll(async () => { s = await startTestServer(); admin = await s.as('admin'); reception = await s.as('receptionist'); otherAdmin = await s.as('otheradmin'); });
  afterAll(async () => { await s.close(); });

  const setVat = async (enabled: boolean, rate = 0) => {
    const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
    const res = await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ row_version: current.row_version, data: { vat_enabled: enabled, vat_rate_percent: rate } }),
    });
    expect(res.status).toBe(200);
  };
  const invoice = (client: ApiClient, orderId: string) => client.post(`/api/v1/admin/orders/${orderId}/invoice`, {});

  describe('VAT is off by default', () => {
    it('a staff-created order has no tax at all', async () => {
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId, { items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: '100' }] });
      expect(await fetchOrder(s, order.id)).toMatchObject({ subtotal: '100.00', tax_total: '0.00', total: '100.00' });
    });
  });

  describe('once the owner enables VAT', () => {
    afterAll(async () => { await setVat(false, 0); });   // never leak VAT into later tests in this file or others

    it('a staff order includes tax in its total', async () => {
      await setVat(true, 11);
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId, { items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: '100' }], delivery_fee: '10' });
      expect(await fetchOrder(s, order.id)).toMatchObject({ subtotal: '100.00', delivery_fee: '10.00', tax_total: '12.10', total: '122.10' }); // 11% of (100+10)
    });

    it('applies to the discounted amount, not the sticker price', async () => {
      await setVat(true, 10);
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId, {
        items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: '100' }], discount_total: '20',
      });
      expect(await fetchOrder(s, order.id)).toMatchObject({ subtotal: '100.00', discount_total: '20.00', tax_total: '8.00', total: '88.00' }); // 10% of 80
    });

    it('a web order is taxed the same way, and pricing the delivery afterwards retaxes the whole thing', async () => {
      await setVat(true, 10);
      const productId = newId();
      expect((await pushOne(admin, mutation('products:insert', productId, { sku: `INV-${productId.slice(-6)}`, name_ar: 'م', name_en: 'P', base_price: '50', is_public: true } as never))).result).toBe('applied');

      const shopper = await customerAccount(s, 'vat-shopper@example.com');
      const placed = await jsonOf<Json>(await shopper.post('/orders', {
        request_id: newId(), items: [{ product_id: productId, quantity: '2' }], fulfillment_type: 'delivery',
        delivery_address: 'x', delivery_city: 'y', payment_method: 'cod',
      }));
      expect(placed.total).toBe('110.00');   // 2 x 50 = 100 subtotal + 10% VAT, delivery unknown yet
      expect(placed.deliveryFeePending).toBe(true);

      const orderId = (await fetchOrderIdByCode(s, placed.code))!;
      const priced = await jsonOf<Json>(await admin.post(`/api/v1/admin/orders/${orderId}/delivery-fee`, { fee: '20' }));
      expect(priced).toMatchObject({ subtotal: '100.00', delivery_fee: '20.00', tax_total: '12.00', total: '132.00' }); // 10% of (100+20)
    });
  });

  describe('the invoice number', () => {
    it('is assigned once, reused on reprint, and separate from the order number', async () => {
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId);
      const before = await fetchOrder(s, order.id);
      expect(before.invoice_number).toBeNull();

      const first = await jsonOf<Json>(await invoice(reception, order.id));
      expect(first.invoice_number).not.toBeNull();
      expect(String(first.invoice_number)).not.toBe(String(before.order_number));
      expect(first.invoice_issued_at).not.toBeNull();

      const second = await jsonOf<Json>(await invoice(reception, order.id));
      expect(second.invoice_number).toBe(first.invoice_number);        // reprint: the same number, not a new one
    });

    it('numbers are gap-free per branch, and a cancelled order never consumes one', async () => {
      const customerId = await createCustomer(reception);
      const a = await createOrder(reception, customerId);
      const b = await createOrder(reception, customerId);
      const cancelled = await createOrder(reception, customerId);

      const invA = await jsonOf<Json>(await invoice(reception, a.id));
      const cancel = await pushOne(admin, mutation('order_status_history:status_change', newId(), {
        order_id: cancelled.id, to_status: 'cancelled', source: 'manual', note: 'test', occurred_at: new Date().toISOString(),
      }));
      expect(cancel.result).toBe('applied');
      const refused = await invoice(reception, cancelled.id);
      expect(refused.status).toBe(400);
      expect(await jsonOf(refused)).toMatchObject({ message: 'order_cancelled' });

      const invB = await jsonOf<Json>(await invoice(reception, b.id));
      expect(Number(invB.invoice_number)).toBe(Number(invA.invoice_number) + 1);   // no gap for the cancelled one
    });

    it('never crosses branches, and 404s for an order that does not exist', async () => {
      const customerId = await createCustomer(reception);
      const order = await createOrder(reception, customerId);
      expect((await invoice(otherAdmin, order.id)).status).toBe(404);
      expect((await invoice(admin, newId())).status).toBe(404);
    });
  });

  describe('the shop\'s legal identity for the invoice, delivered with the session', () => {
    it('starts blank and off, then reflects what the owner saved, immediately on the next login', async () => {
      const first = await jsonOf<Json>(await s.raw.post('/api/v1/auth/login', { identifier: 'admin@test.example', password: 'correct horse battery staple' }));
      expect(first.branch).toMatchObject({ legalNameAr: null, taxNumber: null, vatEnabled: false, vatRatePercent: 0 });

      const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
      await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ row_version: current.row_version, data: { legal_name_ar: 'مطبعة المصطفى ش.م.م', tax_number: 'LB-12345', vat_enabled: true, vat_rate_percent: 11 } }),
      });

      const second = await jsonOf<Json>(await s.raw.post('/api/v1/auth/login', { identifier: 'admin@test.example', password: 'correct horse battery staple' }));
      expect(second.branch).toMatchObject({ legalNameAr: 'مطبعة المصطفى ش.م.م', taxNumber: 'LB-12345', vatEnabled: true, vatRatePercent: 11 });
      await setVat(false, 0);
    });
  });
});

async function fetchOrder(s: TestServer, id: string): Promise<Json> {
  const { rows } = await s.pool.query(
    'SELECT order_number::text, invoice_number::text, invoice_issued_at, subtotal::text, discount_total::text, delivery_fee::text, tax_total::text, total::text FROM orders WHERE id = $1', [id]);
  return rows[0]!;
}
async function fetchOrderIdByCode(s: TestServer, code: string): Promise<string | undefined> {
  const { rows } = await s.pool.query<{ id: string }>('SELECT id FROM orders WHERE public_code = $1', [code]);
  return rows[0]?.id;
}
/** A verified customer account, for placing a web order in these tests. */
async function customerAccount(s: TestServer, email: string) {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://print.example.com' }, body: JSON.stringify(body),
    });
    return res;
  };
  let cookie = '';
  const call = async (path: string, body: unknown) => {
    const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://print.example.com', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
    });
    const set = res.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='));
    if (set) cookie = set.split(';')[0]!;
    return res;
  };
  await post('/signup', { email, password: 'a good long password', full_name: 'VAT Shopper', locale: 'en' });
  const token = new URL(s.linkFor(email)).searchParams.get('token');
  await call('/verify', { token });
  return { post: call };
}
