import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('B2B accounts', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient, otherAdmin: ApiClient;
  beforeAll(async () => { s = await startTestServer(); [admin, staff, otherAdmin] = [await s.as('admin'), await s.as('staff'), await s.as('otheradmin')]; });
  afterAll(async () => { await s.close(); });

  describe('a company profile', () => {
    it('is a customer marked b2b, with a company name, tax number and optional credit limit', async () => {
      const id = newId();
      const r = await pushOne(admin, mutation('customers:insert', id, {
        full_name: 'Nadia Haddad', phone_e164: '+96170555222', whatsapp_opt_in: false,
        customer_type: 'b2b', company_name: 'Haddad Print Supplies', tax_number: 'LB-1234567', credit_limit: '500',
      } as never));
      expect(r).toMatchObject({ result: 'applied', row: { customer_type: 'b2b', company_name: 'Haddad Print Supplies', tax_number: 'LB-1234567', credit_limit: '500.00' } });
    });

    it('setting or changing a credit limit needs customers:credit:manage; everything else about the profile does not', async () => {
      const refused = await pushOne(staff, mutation('customers:insert', newId(), {
        full_name: 'x', phone_e164: '+96170555333', whatsapp_opt_in: false, customer_type: 'b2b', credit_limit: '1000',
      } as never));
      expect(refused).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });

      const id = newId();
      const withoutLimit = await pushOne(staff, mutation('customers:insert', id, {
        full_name: 'x', phone_e164: '+96170555334', whatsapp_opt_in: false, customer_type: 'b2b', company_name: 'Some Co', tax_number: 'LB-9',
      } as never));
      expect(withoutLimit.result).toBe('applied');   // company name and tax number are not gated

      const changeRefused = await pushOne(staff, mutation('customers:update', id, { changes: { credit_limit: '200' }, base: { credit_limit: null } } as never));
      expect(changeRefused).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      const changeAllowed = await pushOne(admin, mutation('customers:update', id, { changes: { credit_limit: '200' }, base: { credit_limit: null } } as never));
      expect(changeAllowed).toMatchObject({ result: 'applied', row: { credit_limit: '200.00' } });
    });
  });

  describe('the credit limit', () => {
    const b2b = (limit: string) => pushOne(admin, mutation('customers:insert', newId(), {
      full_name: 'Credit Co', phone_e164: `+9617${Math.floor(1e6 + Math.random() * 9e6)}`, whatsapp_opt_in: false,
      customer_type: 'b2b', company_name: 'Credit Co', credit_limit: limit,
    } as never)).then((r) => r.row!.id as string);
    const orderOf = (client: ApiClient, customerId: string, price: string) =>
      createOrder(client, customerId, { items: [{ id: newId(), name_snapshot: 'x', quantity: '1', unit_price: price }] } as never);

    it('blocks a new order that would push a company over its limit, and staff see only the refusal', async () => {
      const id = await b2b('100');
      expect((await orderOf(staff, id, '60')).id).toBeTruthy();
      const refused = await pushOne(staff, mutation('orders:insert', newId(), {
        public_code: newId().replace(/-/g, '').slice(0, 12).toUpperCase(), customer_id: id, items: [{ id: newId(), name_snapshot: 'x', quantity: '1', unit_price: '50' }],
      } as never));
      expect(refused).toMatchObject({ result: 'rejected', error: expect.stringContaining('credit_limit_exceeded') });
    });

    it('the override permission allows crossing it, and a payment brings the balance back down first', async () => {
      const id = await b2b('50');
      const first = await orderOf(admin, id, '50');
      expect(first.id).toBeTruthy();   // exactly at the limit: fine
      expect((await orderOf(admin, id, '1')).id).toBeTruthy();   // admin: has orders:credit:override

      await pushOne(admin, mutation('transactions:insert', newId(), { order_id: first.id, txn_type: 'payment', method: 'cash', amount: '51' } as never));
      // paying $51 against the $50 first order nets the two orders' outstanding to exactly zero; staff can now
      // place a fresh order up to the $50 limit itself without needing the override at all.
      const afterPaying = await orderOf(staff, id, '50');
      expect(afterPaying.id).toBeTruthy();
    });

    it('a cancelled order never counts toward the balance', async () => {
      const id = await b2b('50');
      const order = await orderOf(admin, id, '50');
      await pushOne(admin, mutation('order_status_history:status_change', newId(), { order_id: order.id, to_status: 'cancelled', source: 'manual', note: 'x', occurred_at: new Date().toISOString() } as never));
      expect((await orderOf(staff, id, '50')).id).toBeTruthy();   // the cancelled 50 does not count; a fresh 50 still fits
    });

    it('raising an existing order through "edit items" is held to the same limit', async () => {
      const id = await b2b('50');
      const placed = await orderOf(staff, id, '40');
      const edit = (client: ApiClient, price: string) => pushOne(client, mutation('orders:edit_items', placed.id, { items: [{ id: newId(), name_snapshot: 'x', quantity: '1', unit_price: price }] } as never));
      expect(await edit(staff, '5000')).toMatchObject({ result: 'rejected', error: expect.stringContaining('credit_limit_exceeded') });
      expect((await s.pool.query('SELECT total::text FROM orders WHERE id = $1', [placed.id])).rows[0].total).toBe('40.00');   // untouched
      expect((await edit(staff, '50')).result).toBe('applied');     // up to the limit itself: fine
      expect((await edit(admin, '5000')).result).toBe('applied');   // the override permission may exceed it
    });

    it('no limit set at all means no check, ever', async () => {
      const id = await createCustomer(staff, { customer_type: 'b2b', company_name: 'No Limit LLC' } as never);
      expect((await orderOf(staff, id, '999999')).id).toBeTruthy();
    });
  });

  describe('a company\'s price list', () => {
    const product = async (client: ApiClient, price = '1') => {
      const id = newId();
      const r = await pushOne(client, mutation('products:insert', id, { sku: `B2B-${id}`, name_ar: 'x', name_en: 'x', base_price: price } as never));
      expect(r.result).toBe('applied');
      return id;
    };

    it('one price per customer per product, changeable, and removable', async () => {
      const customerId = await createCustomer(staff);
      const productId = await product(admin);
      const id = newId();
      const created = await pushOne(staff, mutation('company_price_overrides:insert', id, { customer_id: customerId, product_id: productId, unit_price: '0.08' } as never));
      expect(created).toMatchObject({ result: 'applied', row: { unit_price: '0.0800' } });

      const dup = await pushOne(staff, mutation('company_price_overrides:insert', newId(), { customer_id: customerId, product_id: productId, unit_price: '0.05' } as never));
      expect(dup).toMatchObject({ result: 'rejected', error: expect.stringContaining('already_exists') });

      const updated = await pushOne(staff, mutation('company_price_overrides:update', id, { unit_price: '0.06', base: { unit_price: '0.0800' } } as never));
      expect(updated).toMatchObject({ result: 'applied', row: { unit_price: '0.0600' } });

      expect((await pushOne(staff, mutation('company_price_overrides:delete', id, {} as never))).result).toBe('applied');
      const { rows } = await s.pool.query('SELECT 1 FROM company_price_overrides WHERE id = $1 AND deleted_at IS NULL', [id]);
      expect(rows).toHaveLength(0);

      // deleted: the same customer+product pair can be given a fresh price again
      const again = await pushOne(staff, mutation('company_price_overrides:insert', newId(), { customer_id: customerId, product_id: productId, unit_price: '0.07' } as never));
      expect(again.result).toBe('applied');
    });

    it('never for a customer or product from another branch', async () => {
      const foreignCustomer = await createCustomer(otherAdmin);
      const productId = await product(admin);
      expect(await pushOne(staff, mutation('company_price_overrides:insert', newId(), { customer_id: foreignCustomer, product_id: productId, unit_price: '1' } as never)))
        .toMatchObject({ result: 'rejected', error: expect.stringContaining('not_found') });

      const customerId = await createCustomer(staff);
      const foreignProduct = await product(otherAdmin);
      const r = await pushOne(staff, mutation('company_price_overrides:insert', newId(), { customer_id: customerId, product_id: foreignProduct, unit_price: '1' } as never));
      expect(r).toMatchObject({ result: 'rejected', error: expect.stringContaining('reference_not_found') });
    });
  });

  it('requires customers:write throughout', async () => {
    const operator = await s.as('operator');
    expect((await pushOne(operator, mutation('customers:insert', newId(), { full_name: 'x', phone_e164: '+96170000999', whatsapp_opt_in: false } as never))).result).toBe('rejected');
    const customerId = await createCustomer(staff);
    const productId = await (async () => { const id = newId(); await pushOne(admin, mutation('products:insert', id, { sku: `OP-${id}`, name_ar: 'x', name_en: 'x', base_price: '1' } as never)); return id; })();
    expect((await pushOne(operator, mutation('company_price_overrides:insert', newId(), { customer_id: customerId, product_id: productId, unit_price: '1' } as never))).result).toBe('rejected');
  });

  describe('consolidated invoices', () => {
    const CI = '/api/v1/admin/company-invoices';
    const company = async () => (await pushOne(admin, mutation('customers:insert', newId(), {
      full_name: 'Invoice Co', phone_e164: `+9617${Math.floor(1e6 + Math.random() * 9e6)}`, whatsapp_opt_in: false,
      customer_type: 'b2b', company_name: 'Invoice Co', tax_number: 'LB-777',
    } as never))).row!.id as string;
    const order = (customerId: string, price: string) =>
      createOrder(staff, customerId, { items: [{ id: newId(), name_snapshot: 'x', quantity: '1', unit_price: price }] } as never);

    it('lists what is still unbilled, issues one numbered invoice for several orders, with exact totals', async () => {
      const id = await company();
      const a = await order(id, '20'); const b = await order(id, '35.50');
      const unbilled = await jsonOf<Json[]>(await staff.get(`${CI}/unbilled?customer_id=${id}`));
      expect(unbilled.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());

      const res = await staff.post(CI, { customer_id: id, order_ids: [a.id, b.id] });
      expect(res.status).toBe(201);
      const invoice = await jsonOf<Json>(res);
      expect(invoice).toMatchObject({ total: '55.50', subtotal: '55.50', tax_total: '0.00', order_count: 2, company_name: 'Invoice Co', customer_tax_number: 'LB-777' });
      expect(invoice.orders).toHaveLength(2);
      expect(await jsonOf<Json[]>(await staff.get(`${CI}/unbilled?customer_id=${id}`))).toEqual([]);   // nothing left to bill

      const next = await jsonOf<Json>(await staff.post(CI, { customer_id: id, order_ids: [(await order(id, '1')).id] }));
      expect(Number(next.invoice_number)).toBe(Number(invoice.invoice_number) + 1);   // its own gap-free series
    });

    it('with VAT on, splits every order into net and tax, and totals both exactly', async () => {
      const settings = async (data: Json) => {
        const current = await jsonOf<Json>(await admin.get('/api/v1/admin/team/branch-settings'));
        await fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
          body: JSON.stringify({ row_version: current.row_version, data }),
        });
      };
      await settings({ vat_enabled: true, vat_rate_percent: 11 });
      try {
        const id = await company();
        const a = await order(id, '100'); const b = await order(id, '50');    // 111.00 and 55.50 with 11% VAT
        const invoice = await jsonOf<Json>(await staff.post(CI, { customer_id: id, order_ids: [a.id, b.id] }));
        expect(invoice).toMatchObject({ subtotal: '150.00', tax_total: '16.50', total: '166.50' });
        expect(invoice.orders.map((o: Json) => [o.net, o.tax_total, o.total])).toEqual([['100.00', '11.00', '111.00'], ['50.00', '5.50', '55.50']]);
      } finally {
        await settings({ vat_enabled: false, vat_rate_percent: 0 });
      }
    });

    it('an order is invoiced once: never on two consolidated invoices, never both ways', async () => {
      const id = await company();
      const a = await order(id, '10');
      expect((await staff.post(CI, { customer_id: id, order_ids: [a.id] })).status).toBe(201);
      expect(await jsonOf(await staff.post(CI, { customer_id: id, order_ids: [a.id] }))).toMatchObject({ message: 'already_invoiced' });
      expect(await jsonOf(await staff.post(`/api/v1/admin/orders/${a.id}/invoice`, {}))).toMatchObject({ message: 'on_company_invoice' });

      const b = await order(id, '10');
      await staff.post(`/api/v1/admin/orders/${b.id}/invoice`, {});   // invoiced on its own first
      expect(await jsonOf(await staff.post(CI, { customer_id: id, order_ids: [b.id] }))).toMatchObject({ message: 'already_invoiced' });
      // and the database itself refuses it, whatever code path might try
      await expect(s.pool.query(`UPDATE orders SET company_invoice_id = (SELECT id FROM company_invoices LIMIT 1) WHERE id = $1`, [b.id])).rejects.toThrow(/orders_invoiced_once/);
    });

    it('refuses what would be wrong on paper: a cancelled order, another customer\'s order, a non-company', async () => {
      const id = await company();
      const cancelled = await order(id, '10');
      await pushOne(admin, mutation('order_status_history:status_change', newId(), { order_id: cancelled.id, to_status: 'cancelled', source: 'manual', note: 'x', occurred_at: new Date().toISOString() } as never));
      expect(await jsonOf(await staff.post(CI, { customer_id: id, order_ids: [cancelled.id] }))).toMatchObject({ message: 'order_cancelled' });

      const otherCompany = await company();
      const theirs = await order(otherCompany, '10');
      expect(await jsonOf(await staff.post(CI, { customer_id: id, order_ids: [theirs.id] }))).toMatchObject({ message: 'order_of_another_customer' });

      const person = await createCustomer(staff);
      const personal = await order(person, '10');
      expect(await jsonOf(await staff.post(CI, { customer_id: person, order_ids: [personal.id] }))).toMatchObject({ message: 'not_a_company' });
    });

    it('an issued invoice is permanent: the database refuses to change or delete it', async () => {
      const id = await company();
      const inv = await jsonOf<Json>(await staff.post(CI, { customer_id: id, order_ids: [(await order(id, '5')).id] }));
      await expect(s.pool.query(`UPDATE company_invoices SET total = 0 WHERE id = $1`, [inv.id])).rejects.toThrow(/append-only/);
      await expect(s.pool.query(`DELETE FROM company_invoices WHERE id = $1`, [inv.id])).rejects.toThrow(/append-only/);
    });

    it('never reaches another branch', async () => {
      const id = await company();
      const inv = await jsonOf<Json>(await staff.post(CI, { customer_id: id, order_ids: [(await order(id, '5')).id] }));
      expect((await otherAdmin.get(`${CI}/${inv.id}`)).status).toBe(404);
      expect((await otherAdmin.post(CI, { customer_id: id, order_ids: [(await order(id, '5')).id] })).status).toBe(404);
    });
  });
});

