import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, customerPayload, mutation, newCode, newId, orderPayload, push, pushOne } from './helpers/sync-client';
import { startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

const q = async <T = Record<string, unknown>>(s: TestServer, sql: string, params: unknown[] = []) => (await s.pool.query(sql, params)).rows as T[];

describe.skipIf(!hasTestDatabase)('sync push', () => {
  let s: TestServer;
  let admin: ApiClient, reception: ApiClient, operator: ApiClient, warehouse: ApiClient, otherAdmin: ApiClient;

  beforeAll(async () => {
    s = await startTestServer();
    admin = await s.as('admin');
    reception = await s.as('receptionist');
    operator = await s.as('operator');
    warehouse = await s.as('warehouse');
    otherAdmin = await s.as('otheradmin');
  });
  afterAll(async () => { await s.close(); });

  describe('envelope', () => {
    it('requires authentication and a valid body', async () => {
      expect((await s.raw.post('/api/v1/sync/push', { deviceId: 'device-test-0001', mutations: [] })).status).toBe(401);
      expect((await admin.post('/api/v1/sync/push', { deviceId: 'device-test-0001', mutations: [] })).status).toBe(400);
      expect((await admin.post('/api/v1/sync/push', { mutations: [] })).status).toBe(400);
      const res = await fetch(`${s.baseUrl}/api/v1/sync/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` }, body: '{oops' });
      expect(res.status).toBe(400);
    });

    it('rejects unsupported and invalid mutations with a reason, without failing the batch', async () => {
      const id = newId();
      const results = await push(admin, [
        { id: newId(), entity: 'barcodes', entityId: newId(), op: 'insert', baseVersion: null, payload: {}, clientCreatedAt: new Date().toISOString() },
        mutation('customers:insert', newId(), { full_name: '', phone_e164: '123' } as never),
        mutation('customers:insert', id, customerPayload()),
      ]);
      expect(results.map((r) => r.result)).toEqual(['rejected', 'rejected', 'applied']);          // order preserved, batch not aborted
      expect(results[0]!.error).toMatch(/unsupported_mutation/);
      expect(results[1]!.error).toMatch(/invalid_payload/);
    });

    it('is idempotent: replays answer "duplicate" and repeat the original verdict for rejections', async () => {
      const m = mutation('customers:insert', newId(), customerPayload());
      expect((await pushOne(reception, m)).result).toBe('applied');
      expect((await pushOne(reception, m)).result).toBe('duplicate');
      const bad = mutation('customers:insert', newId(), { full_name: 'x' } as never);
      const first = await pushOne(reception, bad);
      expect(first.result).toBe('rejected');
      expect(await pushOne(reception, bad)).toMatchObject({ result: 'rejected', error: first.error });
      const concurrent = mutation('customers:insert', newId(), customerPayload());
      const both = await Promise.all([pushOne(reception, concurrent), pushOne(reception, concurrent)]);
      expect(both.map((r) => r.result).sort()).toEqual(['applied', 'duplicate']);
      expect(await q(s, 'SELECT 1 FROM client_mutations WHERE id = $1', [concurrent.id])).toHaveLength(1);
    });
  });

  describe('customers', () => {
    it('creates a customer, timestamps the consent, and refuses staff without customers:write', async () => {
      const id = newId();
      const r = await pushOne(reception, mutation('customers:insert', id, customerPayload({ full_name: 'Sara' })));
      expect(r).toMatchObject({ result: 'applied', row: { id, full_name: 'Sara', whatsapp_opt_in: true, consent_source: 'in_person', branch_id: s.fixtures.branchId } });
      expect(r.row!.consent_recorded_at).toBeTruthy();
      expect(await pushOne(operator, mutation('customers:insert', newId(), customerPayload()))).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
    });

    it('will not accept an opt-in without saying where consent came from', async () => {
      const r = await pushOne(reception, mutation('customers:insert', newId(), customerPayload({ consent_source: undefined })));
      expect(r).toMatchObject({ result: 'rejected', error: expect.stringContaining('consent_source') });
    });

    it('returns the existing customer when another device registered the same phone', async () => {
      const phone = '+96170999001';
      const firstId = await createCustomer(reception, { phone_e164: phone });
      const r = await pushOne(admin, mutation('customers:insert', newId(), customerPayload({ phone_e164: phone })));
      expect(r).toMatchObject({ result: 'conflict', error: 'phone_already_registered', rowEntity: 'customers', row: { id: firstId } });
    });

    it('merges edits to different fields and flags edits to the same field', async () => {
      const id = await createCustomer(reception, { notes: 'orig', city: 'Beirut' });
      const a = await pushOne(reception, mutation('customers:update', id, { changes: { notes: 'call before delivery' }, base: { notes: 'orig' } }));
      const b = await pushOne(admin, mutation('customers:update', id, { changes: { city: 'Tyre' }, base: { city: 'Beirut' } }));    // started from the same old version
      expect([a.result, b.result]).toEqual(['applied', 'applied']);
      expect(b.row).toMatchObject({ notes: 'call before delivery', city: 'Tyre' });

      const stale = await pushOne(admin, mutation('customers:update', id, { changes: { notes: 'other' }, base: { notes: 'orig' } }));
      expect(stale).toMatchObject({ result: 'conflict', error: expect.stringContaining('notes'), row: { notes: 'call before delivery' } });
      const noBase = await pushOne(admin, mutation('customers:update', id, { changes: { notes: 'x' }, base: {} }));
      expect(noBase).toMatchObject({ result: 'rejected', error: expect.stringContaining('missing_base') });
    });

    it('timestamps consent on the server when an opt-in is switched on later', async () => {
      const id = await createCustomer(reception, { whatsapp_opt_in: false, consent_source: undefined, email: 'a@b.co' });
      expect((await q<{ consent_recorded_at: unknown }>(s, 'SELECT consent_recorded_at FROM customers WHERE id = $1', [id]))[0]!.consent_recorded_at).toBeNull();
      const r = await pushOne(reception, mutation('customers:update', id, { changes: { email_opt_in: true, consent_source: 'phone' }, base: { email_opt_in: false, consent_source: null } }));
      expect(r.result).toBe('applied');
      expect(r.row!.consent_recorded_at).toBeTruthy();
    });

    it('never touches another branch', async () => {
      const id = await createCustomer(reception);
      const r = await pushOne(otherAdmin, mutation('customers:update', id, { changes: { notes: 'hijack' }, base: { notes: null } }));
      expect(r).toMatchObject({ result: 'rejected', error: 'not_found' });
    });
  });

  describe('orders', () => {
    it('creates the order, items, barcode, first history entry and the "received" message atomically, with server-side totals', async () => {
      const customerId = await createCustomer(reception, { full_name: 'Layla', whatsapp_opt_in: true });
      await s.pool.query(`INSERT INTO notification_templates (branch_id, template_key, channel, locale, body, variables) VALUES ($1,'order.received','whatsapp','ar','أهلاً {{customer_name}}، طلبك {{order_id}}: {{tracking_url}}','{customer_name,order_id,tracking_url}')`, [s.fixtures.branchId]);

      const id = newId();
      const payload = orderPayload(customerId, {
        discount_total: '1', delivery_fee: 2.5,
        items: [
          { id: newId(), name_snapshot: 'Flyers A5', quantity: '3', unit_price: '10.10', discount: '0.30' },
          { id: newId(), name_snapshot: 'Stickers', quantity: 2, unit_price: 4.5 },
        ],
      });
      const r = await pushOne(reception, mutation('orders:insert', id, { ...payload, total: 1, subtotal: 1 } as never));   // bogus client totals must be ignored
      expect(r).toMatchObject({ result: 'applied', row: { id, status: 'received', subtotal: '39.00', discount_total: '1.00', delivery_fee: '2.50', total: '40.50', currency: 'USD' } });
      expect(r.row!.order_number).toBe('1');

      expect((await q<{ line_total: string }>(s, 'SELECT line_total FROM order_items WHERE order_id = $1 ORDER BY sort_order', [id])).map((x) => x.line_total)).toEqual(['30.00', '9.00']);
      expect(await q(s, `SELECT 1 FROM barcodes WHERE order_id = $1 AND code = $2 AND label_type = 'order'`, [id, payload.public_code])).toHaveLength(1);
      expect(await q(s, `SELECT 1 FROM order_status_history WHERE order_id = $1 AND to_status = 'received'`, [id])).toHaveLength(1);
      const [log] = await q<{ status: string; body: string; recipient: string }>(s, 'SELECT status, body, recipient FROM notification_logs WHERE order_id = $1', [id]);
      expect(log!.status).toBe('queued');
      expect(log!.body).toBe(`أهلاً Layla، طلبك 1: https://print.example.com/ar/track/${payload.public_code}`);

      const second = await createOrder(reception, customerId);
      expect((await q<{ order_number: string }>(s, 'SELECT order_number::text FROM orders WHERE id = $1', [second.id]))[0]!.order_number).toBe('2');
    });

    it('is all-or-nothing: an invalid line leaves no partial order behind', async () => {
      const customerId = await createCustomer(reception);
      const id = newId();
      const r = await pushOne(reception, mutation('orders:insert', id, orderPayload(customerId, { items: [
        { id: newId(), name_snapshot: 'ok', quantity: 1, unit_price: 5 },
        { id: newId(), name_snapshot: 'bad', quantity: 1, unit_price: 5, discount: '999' },     // line total would be negative
      ] })));
      expect(r).toMatchObject({ result: 'rejected', error: expect.stringContaining('constraint_violation') });
      expect(await q(s, 'SELECT 1 FROM orders WHERE id = $1', [id])).toHaveLength(0);
      expect(await q(s, 'SELECT 1 FROM order_items WHERE order_id = $1', [id])).toHaveLength(0);
    });

    it('rejects a discount larger than the order, unknown customers and customers of another branch', async () => {
      const customerId = await createCustomer(reception);
      const foreign = await createCustomer(otherAdmin);
      expect(await pushOne(reception, mutation('orders:insert', newId(), orderPayload(customerId, { discount_total: '500' })))).toMatchObject({ result: 'rejected', error: expect.stringContaining('constraint_violation') });
      expect(await pushOne(reception, mutation('orders:insert', newId(), orderPayload(newId())))).toMatchObject({ result: 'rejected', error: expect.stringContaining('reference_not_found') });
      expect(await pushOne(reception, mutation('orders:insert', newId(), orderPayload(foreign)))).toMatchObject({ result: 'rejected', error: expect.stringContaining('reference_not_found') });
    });

    it('needs orders:create', async () => {
      const customerId = await createCustomer(reception);
      expect(await pushOne(warehouse, mutation('orders:insert', newId(), orderPayload(customerId)))).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
    });

    it('updates non-financial fields with field-level concurrency, closed orders are read-only', async () => {
      const order = await createOrder(reception, await createCustomer(reception));
      const ok = await pushOne(reception, mutation('orders:update', order.id, { changes: { delivery_notes: 'Ring twice' }, base: { delivery_notes: null } }));
      expect(ok).toMatchObject({ result: 'applied', row: { delivery_notes: 'Ring twice' } });
      const stale = await pushOne(admin, mutation('orders:update', order.id, { changes: { delivery_notes: 'x' }, base: { delivery_notes: null } }));
      expect(stale.result).toBe('conflict');
      expect(await pushOne(operator, mutation('orders:update', order.id, { changes: { internal_notes: 'x' }, base: { internal_notes: null } }))).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });

      await s.pool.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [order.id]);
      expect(await pushOne(reception, mutation('orders:update', order.id, { changes: { internal_notes: 'late' }, base: { internal_notes: null } }))).toMatchObject({ result: 'rejected', error: 'order_closed' });
    });

  });

  describe('the catalogue', () => {
    // uuidv7 starts with the millisecond, so two ids made in the same tick share their first characters:
    // a counter is what makes these SKUs actually unique.
    let nextSku = 0;
    const product = (over: Record<string, unknown> = {}) => ({ sku: `SKU-${++nextSku}`, name_ar: 'بطاقات', name_en: 'Cards', ...over });
    const add = (api: ApiClient, over: Record<string, unknown> = {}, id = newId()) => pushOne(api, mutation('products:insert', id, product(over) as never));

    it('adds a product with sensible defaults and keeps its price exact', async () => {
      const r = await add(admin, { base_price: '0.0525', category: 'printing', unit: 'sheet' });
      expect(r).toMatchObject({ result: 'applied', row: { name_en: 'Cards', base_price: '0.0525', unit: 'sheet', pricing_model: 'per_unit', is_active: true, is_public: false } });
      expect(r.row!.min_quantity).toBe('1.000');
    });

    it('stores quantity tiers so devices and the server quote the same price', async () => {
      const tiers = [{ min_quantity: '100', unit_price: '0.06' }, { min_quantity: '500', unit_price: '0.04' }];
      const r = await add(admin, { pricing_model: 'tiered', base_price: '0.08', price_rules: tiers });
      expect(r.row!.price_rules).toEqual(tiers);
    });

    it('refuses a duplicate SKU, a bad SKU and a negative price', async () => {
      const sku = 'SKU-DUPLICATE';
      expect((await add(admin, { sku })).result).toBe('applied');
      expect(await add(admin, { sku })).toMatchObject({ result: 'rejected', error: expect.stringContaining('already_exists') });
      expect(await add(admin, { sku: 'has spaces' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });
      expect(await add(admin, { base_price: '-5' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });
    });

    it('is only for staff who manage the catalogue', async () => {
      expect(await add(reception)).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect(await add(operator)).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
    });

    it('edits a price and its tiers, and retiring a product never touches orders already taken', async () => {
      const id = newId();
      await add(admin, { base_price: '10', pricing_model: 'tiered', price_rules: [{ min_quantity: '10', unit_price: '9' }] }, id);
      // PostgreSQL stores jsonb keys in its own order ("unit_price" before "min_quantity"); a device sends them in
      // the order a person would write them. The same value must never be mistaken for a conflict over that.
      const priced = await pushOne(admin, mutation('products:update', id, {
        changes: { base_price: '12', price_rules: [{ min_quantity: '10', unit_price: '11' }] },
        base: { base_price: '10.0000', price_rules: [{ min_quantity: '10', unit_price: '9' }] },
      }));
      expect(priced).toMatchObject({ result: 'applied', row: { base_price: '12.0000' } });
      expect(priced.row!.price_rules).toEqual([{ min_quantity: '10', unit_price: '11' }]);

      const retired = await pushOne(admin, mutation('products:update', id, { changes: { is_active: false }, base: { is_active: true } }));
      expect(retired).toMatchObject({ result: 'applied', row: { is_active: false } });
    });

    it('flags an edit made from a stale price, instead of overwriting someone else', async () => {
      const id = newId();
      await add(admin, { base_price: '10' }, id);
      await pushOne(admin, mutation('products:update', id, { changes: { base_price: '12' }, base: { base_price: '10.0000' } }));
      const stale = await pushOne(admin, mutation('products:update', id, { changes: { base_price: '15' }, base: { base_price: '10.0000' } }));
      expect(stale).toMatchObject({ result: 'conflict', rowEntity: 'products', row: { base_price: '12.0000' } });
    });

    it('never reaches another branch', async () => {
      const id = newId();
      await add(admin, {}, id);
      expect(await pushOne(otherAdmin, mutation('products:update', id, { changes: { is_active: false }, base: { is_active: true } })))
        .toMatchObject({ result: 'rejected', error: 'not_found' });
    });
  });

  describe('how much staff may discount', () => {
    const withDiscount = (api: ApiClient, over: Record<string, unknown>) =>
      createCustomer(reception).then((customerId) => pushOne(api, mutation('orders:insert', newId(), orderPayload(customerId, {
        items: [{ id: newId(), name_snapshot: 'Cards', quantity: 1, unit_price: '100' }], ...over,
      }))));

    afterAll(async () => { await s.pool.query(`UPDATE branches SET max_discount_percent = NULL WHERE id = $1`, [s.fixtures.branchId]); });

    it('allows anything while the shop has set no limit', async () => {
      await s.pool.query(`UPDATE branches SET max_discount_percent = NULL WHERE id = $1`, [s.fixtures.branchId]);
      expect(await withDiscount(reception, { discount_total: '90' })).toMatchObject({ result: 'applied', row: { total: '10.00' } });
    });

    it('refuses more than the shop allows, counting line discounts too', async () => {
      await s.pool.query(`UPDATE branches SET max_discount_percent = 10 WHERE id = $1`, [s.fixtures.branchId]);
      expect(await withDiscount(reception, { discount_total: '10' })).toMatchObject({ result: 'applied' });          // exactly 10%
      expect(await withDiscount(reception, { discount_total: '10.01' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('discount_too_large') });
      // 6 off the line plus 5 off the order is 11% of the 100 the order was worth before any discount
      const mixed = await pushOne(reception, mutation('orders:insert', newId(), orderPayload(await createCustomer(reception), {
        items: [{ id: newId(), name_snapshot: 'Cards', quantity: 1, unit_price: '100', discount: '6' }], discount_total: '5',
      })));
      expect(mixed).toMatchObject({ result: 'rejected', error: expect.stringContaining('discount_too_large') });
    });

    it('lets a manager go past the limit', async () => {
      await s.pool.query(`UPDATE branches SET max_discount_percent = 10 WHERE id = $1`, [s.fixtures.branchId]);
      expect(await withDiscount(admin, { discount_total: '50' })).toMatchObject({ result: 'applied', row: { total: '50.00' } });
    });

    it('a limit of zero means no discounts at all without a manager', async () => {
      await s.pool.query(`UPDATE branches SET max_discount_percent = 0 WHERE id = $1`, [s.fixtures.branchId]);
      expect(await withDiscount(reception, { discount_total: '0.01' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('discount_too_large') });
      expect(await withDiscount(reception, {})).toMatchObject({ result: 'applied' });
    });
  });

  describe('order status', () => {
    const move = (api: ApiClient, orderId: string, to: string, extra: Record<string, unknown> = {}) =>
      pushOne(api, mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: to as never, source: 'manual', occurred_at: new Date().toISOString(), ...extra }));

    it('applies a scan: history with barcode, new status, and the customer message queued in the same transaction', async () => {
      const customerId = await createCustomer(reception, { whatsapp_opt_in: true });
      const order = await createOrder(reception, customerId);
      await s.pool.query(`INSERT INTO notification_templates (branch_id, template_key, channel, locale, body, variables) VALUES ($1,'order.printing','whatsapp','ar','قيد الطباعة {{order_id}}','{order_id}')`, [s.fixtures.branchId]);

      const r = await move(operator, order.id, 'printing', { source: 'scanner', barcode_code: order.code });
      expect(r).toMatchObject({ result: 'applied', rowEntity: 'orders', row: { id: order.id, status: 'printing' } });
      const [h] = await q<{ source: string; from_status: string; barcode_id: string | null; changed_by: string }>(s, `SELECT source, from_status, barcode_id, changed_by FROM order_status_history WHERE order_id = $1 AND to_status = 'printing'`, [order.id]);
      expect(h).toMatchObject({ source: 'scanner', from_status: 'received', changed_by: s.fixtures.users.operator.id });
      expect(h!.barcode_id).toBeTruthy();
      expect(await q(s, `SELECT 1 FROM notification_logs WHERE order_id = $1 AND template_key = 'order.printing'`, [order.id])).toHaveLength(1);
    });

    it('turns an impossible move into a conflict that carries the server state', async () => {
      const order = await createOrder(reception, await createCustomer(reception));
      const r = await move(admin, order.id, 'delivered');
      expect(r).toMatchObject({ result: 'conflict', rowEntity: 'orders', row: { status: 'received' }, error: expect.stringContaining('received to delivered') });
    });

    it('enforces what each role may set', async () => {
      const order = await createOrder(reception, await createCustomer(reception));
      expect(await move(operator, order.id, 'delivered')).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect(await move(warehouse, order.id, 'printing')).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect(await move(reception, order.id, 'cancelled', { note: 'customer asked' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('orders:cancel') });
      expect(await move(admin, order.id, 'cancelled')).toMatchObject({ result: 'rejected', error: expect.stringContaining('note') });   // never cancel without saying why
      expect(await move(admin, order.id, 'cancelled', { note: 'customer changed mind' })).toMatchObject({ result: 'applied', row: { status: 'cancelled', cancel_reason: 'customer changed mind' } });
    });

    it('treats two devices setting the same status as one change', async () => {
      const order = await createOrder(reception, await createCustomer(reception));
      const [a, b] = await Promise.all([move(operator, order.id, 'printing'), move(reception, order.id, 'in_design').then(() => move(operator, order.id, 'printing'))]);
      expect([a.result, b.result]).toEqual(['applied', 'applied']);
      expect(await q(s, `SELECT 1 FROM order_status_history WHERE order_id = $1 AND to_status = 'printing'`, [order.id])).toHaveLength(1);
    });

    it('never lets an order be moved by another branch', async () => {
      const order = await createOrder(reception, await createCustomer(reception));
      expect(await move(otherAdmin, order.id, 'printing')).toMatchObject({ result: 'rejected', error: 'order_not_found' });
    });
  });

  describe('the store', () => {
    let nextSku = 0;
    const item = (over: Record<string, unknown> = {}) => ({ sku: `ITEM-${++nextSku}`, name_ar: 'ورق', name_en: 'Paper', category: 'paper', unit: 'sheet', ...over });
    const addItem = (api: ApiClient, over: Record<string, unknown> = {}, id = newId()) => pushOne(api, mutation('inventory_items:insert', id, item(over) as never));

    it('adds an item that starts at zero, because a balance is the ledger\'s to decide', async () => {
      const r = await addItem(warehouse, { reorder_level: '50', cost_per_unit: '0.012', supplier_name: 'Hermel Paper' });
      expect(r).toMatchObject({ result: 'applied', row: { name_en: 'Paper', unit: 'sheet', quantity_on_hand: '0.000', reorder_level: '50.000', is_active: true } });
    });

    it('is refused to staff who do not keep the store', async () => {
      expect(await addItem(reception)).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect(await addItem(operator)).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect((await addItem(admin)).result).toBe('applied');
    });

    it('never lets anyone type a balance, even through an edit', async () => {
      const id = newId();
      await addItem(warehouse, {}, id);
      const r = await pushOne(warehouse, mutation('inventory_items:update', id, { changes: { quantity_on_hand: '9999' }, base: { quantity_on_hand: '0.000' } } as never));
      expect(r).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });
      expect(await q(s, 'SELECT quantity_on_hand FROM inventory_items WHERE id = $1', [id])).toEqual([{ quantity_on_hand: '0.000' }]);
    });

    it('edits what the shop keeps and retires an item without losing its history', async () => {
      const id = newId();
      await addItem(warehouse, { reorder_level: '50' }, id);
      expect(await pushOne(warehouse, mutation('inventory_items:update', id, { changes: { reorder_level: '120', supplier_name: 'Beirut Paper' }, base: { reorder_level: '50.000', supplier_name: null } })))
        .toMatchObject({ result: 'applied', row: { reorder_level: '120.000', supplier_name: 'Beirut Paper' } });
      expect(await pushOne(warehouse, mutation('inventory_items:update', id, { changes: { is_active: false }, base: { is_active: true } })))
        .toMatchObject({ result: 'applied', row: { is_active: false } });
    });
  });

  describe('recipes and automatic deduction', () => {
    let paperId: string, inkId: string, productId: string, nextSku = 0;

    const newItem = async (over: Record<string, unknown> = {}) => {
      const id = newId();
      const r = await pushOne(warehouse, mutation('inventory_items:insert', id, { sku: `MAT-${++nextSku}`, name_ar: 'مادة', name_en: 'Material', category: 'paper', unit: 'sheet', ...over } as never));
      expect(r.result).toBe('applied');
      return id;
    };
    const newProduct = async () => {
      const id = newId();
      expect((await pushOne(admin, mutation('products:insert', id, { sku: `PRD-${++nextSku}`, name_ar: 'منتج', name_en: 'Product', base_price: '1' } as never))).result).toBe('applied');
      return id;
    };
    const stockOf = async (itemId: string) => (await q<{ quantity_on_hand: string }>(s, 'SELECT quantity_on_hand FROM inventory_items WHERE id = $1', [itemId]))[0]!.quantity_on_hand;
    const receive = async (itemId: string, amount: string) => {
      const r = await pushOne(warehouse, mutation('stock_movements:stock_movement', newId(), { item_id: itemId, movement_type: 'receipt', quantity_delta: amount, occurred_at: new Date().toISOString() }));
      expect(r.result).toBe('applied');
    };
    const recipe = (over: Record<string, unknown>) => pushOne(warehouse, mutation('product_materials:insert', newId(), { product_id: productId, ...over } as never));
    const orderOf = async (quantity: string) => {
      const customerId = await createCustomer(reception);
      const id = newId();
      const r = await pushOne(reception, mutation('orders:insert', id, orderPayload(customerId, {
        items: [{ id: newId(), name_snapshot: 'Job', quantity, unit_price: '1', product_id: productId }],
      })));
      expect(r.result).toBe('applied');
      return id;
    };
    const startPrinting = (orderId: string) =>
      pushOne(operator, mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: 'printing', source: 'manual', occurred_at: new Date().toISOString() }));

    beforeAll(async () => {
      [paperId, inkId, productId] = [await newItem(), await newItem({ category: 'ink', unit: 'ml' }), await newProduct()];
      await receive(paperId, '10000');
      await receive(inkId, '5000');
      expect((await recipe({ item_id: paperId, quantity_per_unit: '1', waste_pct: '5' })).result).toBe('applied');   // 5% waste on paper
      expect((await recipe({ item_id: inkId, quantity_per_unit: '0.25' })).result).toBe('applied');
    });

    it('takes the materials out of the store the moment a job starts printing, waste included', async () => {
      const orderId = await orderOf('1000');
      expect((await startPrinting(orderId)).result).toBe('applied');
      expect(await stockOf(paperId)).toBe('8950.000');       // 10000 - 1000 x 1 x 1.05
      expect(await stockOf(inkId)).toBe('4750.000');         // 5000 - 1000 x 0.25

      const movements = await q<{ movement_type: string; reason: string; quantity_delta: string; created_by: string }>(
        s, `SELECT movement_type, reason, quantity_delta::text, created_by FROM stock_movements WHERE order_id = $1 ORDER BY quantity_delta`, [orderId]);
      expect(movements).toHaveLength(2);
      expect(movements[0]).toMatchObject({ movement_type: 'consumption', reason: 'auto:bom', quantity_delta: '-1050.000', created_by: s.fixtures.users.operator.id });
    });

    it('deducts once per trip to the press: a replay changes nothing, a reprint consumes again', async () => {
      const orderId = await orderOf('100');
      const change = mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: 'printing', source: 'manual', occurred_at: new Date().toISOString() });
      const before = Number(await stockOf(paperId));

      expect((await pushOne(operator, change)).result).toBe('applied');
      expect((await pushOne(operator, change)).result).toBe('duplicate');       // the same change resent
      expect((await startPrinting(orderId)).result).toBe('applied');            // already printing: nothing happens
      expect(Number(await stockOf(paperId))).toBe(before - 105);

      // the job fails at finishing and goes back to the press: that really does eat more paper
      const move = (to: string) => pushOne(operator, mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: to as never, source: 'manual', occurred_at: new Date().toISOString() }));
      expect((await move('finishing')).result).toBe('applied');
      expect((await move('printing')).result).toBe('applied');
      expect(Number(await stockOf(paperId))).toBe(before - 210);
      expect(await q(s, `SELECT 1 FROM stock_movements WHERE order_id = $1`, [orderId])).toHaveLength(4);
    });

    it('a job whose product has no recipe consumes nothing, and a deleted recipe line stops applying', async () => {
      const plain = await newProduct();
      const customerId = await createCustomer(reception);
      const id = newId();
      expect((await pushOne(reception, mutation('orders:insert', id, orderPayload(customerId, { items: [{ id: newId(), name_snapshot: 'Plain', quantity: '10', unit_price: '1', product_id: plain }] })))).result).toBe('applied');
      expect((await startPrinting(id)).result).toBe('applied');
      expect(await q(s, 'SELECT 1 FROM stock_movements WHERE order_id = $1', [id])).toHaveLength(0);

      const line = await recipe({ item_id: paperId, quantity_per_unit: '2' });
      expect((await pushOne(warehouse, mutation('product_materials:delete', line.row!.id as string, {}))).result).toBe('applied');
      const after = await orderOf('10');
      await startPrinting(after);
      expect(await q(s, 'SELECT 1 FROM stock_movements WHERE order_id = $1', [after])).toHaveLength(2);   // still only the two live lines
    });

    it('records the truth even when the store runs short, instead of blocking the press', async () => {
      const scarce = await newItem();
      const product = await newProduct();
      expect((await pushOne(warehouse, mutation('product_materials:insert', newId(), { product_id: product, item_id: scarce, quantity_per_unit: '1' } as never))).result).toBe('applied');
      const customerId = await createCustomer(reception);
      const id = newId();
      await pushOne(reception, mutation('orders:insert', id, orderPayload(customerId, { items: [{ id: newId(), name_snapshot: 'Big', quantity: '500', unit_price: '1', product_id: product }] })));
      expect((await startPrinting(id)).result).toBe('applied');
      expect(await stockOf(scarce)).toBe('-500.000');
    });

    it('recipes belong to the branch that wrote them', async () => {
      expect(await pushOne(otherAdmin, mutation('product_materials:insert', newId(), { product_id: productId, item_id: paperId, quantity_per_unit: '1' } as never)))
        .toMatchObject({ result: 'rejected' });
    });
  });

  describe('inventory', () => {
    let itemId: string;
    beforeAll(async () => {
      itemId = (await q<{ id: string }>(s, `INSERT INTO inventory_items (branch_id, sku, name_ar, name_en, category, unit, reorder_level) VALUES ($1,'PAPER-A4','ورق','A4 paper','paper','sheet',50) RETURNING id`, [s.fixtures.branchId]))[0]!.id;
    });
    const moveStock = (api: ApiClient, type: string, delta: string | number, over: Record<string, unknown> = {}, id = newId()) =>
      pushOne(api, mutation('stock_movements:stock_movement', id, { item_id: itemId, movement_type: type as never, quantity_delta: delta, occurred_at: new Date().toISOString(), ...over }));

    it('keeps the ledger and returns the new balance; replays never double-count', async () => {
      const receipt = await moveStock(warehouse, 'receipt', 100);
      expect(receipt).toMatchObject({ result: 'applied', rowEntity: 'inventory_items', row: { quantity_on_hand: '100.000' } });
      const id = newId();
      expect(await moveStock(operator, 'consumption', -30, {}, id)).toMatchObject({ row: { quantity_on_hand: '70.000' } });
      const again = await pushOne(operator, mutation('stock_movements:stock_movement', id, { item_id: itemId, movement_type: 'consumption', quantity_delta: -30, occurred_at: new Date().toISOString() }));
      expect(again.result).toBe('applied');            // a fresh mutation that reuses the movement id: no second deduction
      expect((await q<{ quantity_on_hand: string }>(s, 'SELECT quantity_on_hand FROM inventory_items WHERE id = $1', [itemId]))[0]!.quantity_on_hand).toBe('70.000');
    });

    it('adds up concurrent consumption from several devices', async () => {
      const before = Number((await q<{ quantity_on_hand: string }>(s, 'SELECT quantity_on_hand FROM inventory_items WHERE id = $1', [itemId]))[0]!.quantity_on_hand);
      await Promise.all(Array.from({ length: 5 }, () => moveStock(operator, 'consumption', -2)));
      const after = Number((await q<{ quantity_on_hand: string }>(s, 'SELECT quantity_on_hand FROM inventory_items WHERE id = $1', [itemId]))[0]!.quantity_on_hand);
      expect(after).toBe(before - 10);
    });

    it('checks permission per movement type, sign, and item ownership', async () => {
      expect(await moveStock(operator, 'receipt', 10)).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect(await moveStock(reception, 'consumption', -1)).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect(await moveStock(operator, 'consumption', 5)).toMatchObject({ result: 'rejected', error: expect.stringContaining('constraint_violation') });
      expect(await moveStock(operator, 'consumption', 0)).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });
      expect(await moveStock(operator, 'consumption', -1, { item_id: newId() })).toMatchObject({ result: 'rejected', error: expect.stringContaining('reference_not_found') });
      expect(await moveStock(otherAdmin, 'adjustment', 5)).toMatchObject({ result: 'rejected', error: expect.stringContaining('reference_not_found') });
    });
  });

  describe('payments', () => {
    const pay = (api: ApiClient, orderId: string, over: Record<string, unknown> = {}) =>
      pushOne(api, mutation('transactions:insert', newId(), { order_id: orderId, txn_type: 'payment', method: 'cash', amount: 10, ...over } as never));
    const orderState = async (id: string) => (await q<{ paid_total: string; payment_status: string }>(s, 'SELECT paid_total::text, payment_status FROM orders WHERE id = $1', [id]))[0]!;

    it('records cash and refunds and keeps the order payment state right', async () => {
      const order = await createOrder(reception, await createCustomer(reception), { items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: 40 }] });
      expect((await pay(reception, order.id, { amount: '15.5' })).result).toBe('applied');
      expect(await orderState(order.id)).toEqual({ paid_total: '15.50', payment_status: 'partial' });
      await pay(reception, order.id, { amount: '24.5', method: 'cod' });
      expect(await orderState(order.id)).toEqual({ paid_total: '40.00', payment_status: 'paid' });

      expect(await pay(admin, order.id, { txn_type: 'refund', amount: 100 })).toMatchObject({ result: 'rejected', error: 'refund_exceeds_paid' });
      expect(await pay(reception, order.id, { txn_type: 'refund', amount: 5 })).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect((await pay(admin, order.id, { txn_type: 'refund', amount: 40 })).result).toBe('applied');
      expect((await orderState(order.id)).payment_status).toBe('refunded');
    });

    it('records who collected a COD payment, and devices never record wallet payments', async () => {
      const order = await createOrder(reception, await createCustomer(reception));
      expect(await pay(reception, order.id, { method: 'cod', amount: 25 })).toMatchObject({ result: 'applied', row: { method: 'cod', collected_by: s.fixtures.users.receptionist.id, status: 'completed' } });
      expect(await pay(admin, order.id, { method: 'whish_money' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('invalid_payload') });
    });

    it('refuses payments on cancelled orders and other branches, and dust amounts', async () => {
      const order = await createOrder(reception, await createCustomer(reception));
      expect(await pay(otherAdmin, order.id)).toMatchObject({ result: 'rejected', error: 'order_not_found' });
      expect(await pay(reception, order.id, { amount: '0.004' })).toMatchObject({ result: 'rejected', error: expect.stringContaining('constraint_violation') });
      await s.pool.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [order.id]);
      expect(await pay(reception, order.id)).toMatchObject({ result: 'rejected', error: 'order_cancelled' });
    });
  });

  describe('settling COD cash', () => {
    const settle = (api: ApiClient, txnId: string, at = new Date().toISOString()) =>
      pushOne(api, mutation('transactions:settle', txnId, { settled_at: at }));
    const collectCod = async (orderId: string) => {
      const r = await pushOne(reception, mutation('transactions:insert', newId(), { order_id: orderId, txn_type: 'payment', method: 'cod', amount: 25 }));
      expect(r.result).toBe('applied');
      return r.row!.id as string;
    };
    const codOrder = async () => createOrder(reception, await createCustomer(reception));

    it('records who took the cash and when, and settling twice changes nothing', async () => {
      const txnId = await collectCod((await codOrder()).id);
      expect(await q(s, 'SELECT settled_at FROM transactions WHERE id = $1', [txnId])).toEqual([{ settled_at: null }]);

      const first = await settle(reception, txnId);
      expect(first).toMatchObject({ result: 'applied', row: { id: txnId, settled_by: s.fixtures.users.receptionist.id } });
      expect(first.row!.settled_at).toBeTruthy();

      const again = await settle(admin, txnId);
      expect(again.result).toBe('applied');
      expect(again.row!.settled_at).toBe(first.row!.settled_at);                 // the first hand-over stands
      expect(again.row!.settled_by).toBe(s.fixtures.users.receptionist.id);
    });

    it('is refused without the permission, across branches, and for anything that is not collected COD', async () => {
      const txnId = await collectCod((await codOrder()).id);
      expect(await settle(operator, txnId)).toMatchObject({ result: 'rejected', error: expect.stringContaining('forbidden') });
      expect(await settle(otherAdmin, txnId)).toMatchObject({ result: 'rejected', error: 'transaction_not_found' });
      expect(await settle(admin, newId())).toMatchObject({ result: 'rejected', error: 'transaction_not_found' });

      const counterCash = await pushOne(reception, mutation('transactions:insert', newId(), { order_id: (await createOrder(reception, await createCustomer(reception))).id, txn_type: 'payment', method: 'cash', amount: 5 }));
      expect(await settle(admin, counterCash.row!.id as string)).toMatchObject({ result: 'rejected', error: 'not_settleable' });
    });

    it('never records a hand-over in the future', async () => {
      const txnId = await collectCod((await codOrder()).id);
      const result = await settle(admin, txnId, new Date(Date.now() + 86_400_000).toISOString());
      expect(new Date(String(result.row!.settled_at)).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  it('keeps a full audit trail of every verdict', async () => {
    const rows = await q<{ result: string; n: string }>(s, 'SELECT result, count(*)::text AS n FROM client_mutations GROUP BY result');
    const byResult = Object.fromEntries(rows.map((r) => [r.result, Number(r.n)]));
    expect(byResult.applied).toBeGreaterThan(20);
    expect(byResult.rejected).toBeGreaterThan(10);
    expect(byResult.conflict).toBeGreaterThan(2);
    expect((await q(s, `SELECT 1 FROM client_mutations WHERE device_id <> 'device-test-0001'`))).toHaveLength(0);
    void newCode;
  });
});
