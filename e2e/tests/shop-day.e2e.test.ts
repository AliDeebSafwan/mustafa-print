import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hasTestDatabase } from '../../apps/api/tests/helpers/test-db'
import { createCustomer, createOrder, mutation, newId, pushOne } from '../../apps/api/tests/helpers/sync-client'
import { startTestServer, type ApiClient, type TestServer } from '../../apps/api/tests/helpers/test-server'
import { addRecipeLine, cancelOrder, changeOrderStatus, createInventoryItem, createProduct, editCustomer, editOrder, materialsFor, priceFor, recordMovement, createCustomerLocally, createOrderLocally, recordPaymentLocally, settleCod, unsettledCod } from '../../apps/admin/src/offline/actions'
import { db } from '../../apps/admin/src/offline/db'
import { retryConflict, unresolvedConflicts } from '../../apps/admin/src/offline/review'
import { syncNow, type SyncDeps } from '../../apps/admin/src/offline/sync'
import { createContentApi } from '../../apps/admin/src/content/api'

/**
 * The real staff-app code (IndexedDB, actions, sync engine) talking to the real API and PostgreSQL.
 * Each test plays out a situation from the shop floor: offline first, then the connection comes back.
 */
describe.skipIf(!hasTestDatabase)('a day in the shop', () => {
  let s: TestServer;
  let reception: ApiClient, admin: ApiClient, staff: ApiClient, operator: ApiClient, warehouse: ApiClient;

  const device = (api: ApiClient, id = 'device-e2e-0001'): SyncDeps => ({ baseUrl: s.baseUrl, deviceId: id, getToken: async () => api.token ?? null });
  const offline: Pick<SyncDeps, 'fetchImpl'> = { fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch };
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await s.pool.query(sql, params)).rows as T[];
  const conflictCount = () => db.conflicts.where('resolved').equals(0).count();
  const jsonOf = async <T,>(res: Response): Promise<T> => res.json() as Promise<T>;
  const editorFor = (api: ApiClient) => createContentApi({ baseUrl: s.baseUrl, getToken: async () => api.token ?? null });
  let visitorN = 0;
  const webCustomer = () => {
    const ip = `203.0.113.${++visitorN}`;
    let cookie = '';
    return {
      post: async (path: string, body: unknown) => {
        const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://print.example.com', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
        const set = res.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='));
        if (set) cookie = set.split(';')[0]!;
        return res;
      },
      get: (path: string) => fetch(`${s.baseUrl}/api/v1/public/account${path}`, { headers: { Cookie: cookie } }),
    };
  };

  beforeAll(async () => {
    s = await startTestServer();
    reception = await s.as('receptionist');
    admin = await s.as('admin');
    staff = await s.as('staff');
    operator = await s.as('operator');
    warehouse = await s.as('warehouse');
    await s.pool.query(
      `INSERT INTO notification_templates (branch_id, template_key, channel, locale, body, variables)
       VALUES ($1, 'order.received', 'whatsapp', 'ar', 'أهلاً {{customer_name}}، طلبك {{order_id}}: {{tracking_url}}', '{customer_name,order_id,tracking_url}')`, [s.fixtures.branchId]);
  });
  afterAll(async () => { await s.close(); });
  beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())); });

  it('customer, order and payment taken with no internet all reach the server intact once the connection returns', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Layla Nasser', phone: '+96170444111', whatsappOptIn: true });
    const order = await createOrderLocally({
      customerId: customer.id, fulfillmentType: 'delivery', deliveryAddress: 'Main street', deliveryCity: 'Hermel', deliveryFee: '2.50', discountTotal: '1',
      items: [{ name: 'Flyers A5', quantity: '3', unitPrice: '10.10', discount: '0.30' }, { name: 'Stickers', quantity: 2, unitPrice: 4.5 }],
    });
    await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cash', amount: '20' });
    const preview = { subtotal: order.subtotal, total: order.total };
    expect(preview).toEqual({ subtotal: '39.00', total: '40.50' });

    // no connection: everything stays queued, nothing is lost
    const stillOffline = await syncNow({ ...device(reception), ...offline });
    expect(stillOffline.push.status).toBe('offline');
    expect(await db.outbox.count()).toBe(3);
    expect(await q('SELECT 1 FROM orders WHERE public_code = $1', [order.public_code])).toHaveLength(0);

    // connection back
    const result = await syncNow(device(reception));
    expect(result.push).toMatchObject({ status: 'ok', applied: 3, conflicts: 0 });
    expect(result.pull.status).toBe('ok');
    expect(await db.outbox.count()).toBe(0);
    expect(await conflictCount()).toBe(0);

    // what the cashier saw is what the server stored
    const [server] = await q<{ order_number: string; subtotal: string; total: string; paid_total: string; payment_status: string; status: string; delivery_address: string }>(
      'SELECT order_number::text, subtotal::text, total::text, paid_total::text, payment_status, status, delivery_address FROM orders WHERE id = $1', [order.id]);
    expect(server).toMatchObject({ subtotal: preview.subtotal, total: preview.total, paid_total: '20.00', payment_status: 'partial', status: 'received', delivery_address: 'Main street' });

    // and the device now shows the server's truth: real order number, payment state, nothing pending
    const local = (await db.orders.get(order.id))!;
    expect(local).toMatchObject({ order_number: server!.order_number, total: preview.total, paid_total: '20.00', payment_status: 'partial' });
    expect(local._pending).toBeFalsy();
    expect((await db.customers.get(customer.id))!._pending).toBeFalsy();
    const payment = (await db.transactions.where('order_id').equals(order.id).toArray())[0]!;
    expect(payment).toMatchObject({ amount: '20.00', status: 'completed' });
    expect(payment._pending).toBeFalsy();

    // server-side effects of the same transaction
    const [c] = await q<{ whatsapp_opt_in: boolean; consent_recorded_at: Date | null; consent_source: string }>('SELECT whatsapp_opt_in, consent_recorded_at, consent_source FROM customers WHERE id = $1', [customer.id]);
    expect(c).toMatchObject({ whatsapp_opt_in: true, consent_source: 'in_person' });
    expect(c!.consent_recorded_at).not.toBeNull();
    const [message] = await q<{ status: string; body: string }>('SELECT status, body FROM notification_logs WHERE order_id = $1', [order.id]);
    expect(message!.status).toBe('queued');
    expect(message!.body).toContain(`/ar/track/${order.public_code}`);
    expect(await db.barcodes.where('order_id').equals(order.id).count()).toBe(1);                 // the label barcode came back too
  });

  it('a second device that has never synced receives the whole picture', async () => {
    const customerId = await createCustomer(reception, { full_name: 'Omar Khoury' });
    const order = await createOrder(reception, customerId, { items: [{ id: newId(), name_snapshot: 'Posters', quantity: 2, unit_price: 12 }] });
    await pushOne(reception, mutation('transactions:insert', newId(), { order_id: order.id, txn_type: 'payment', method: 'cash', amount: 24 }));

    const result = await syncNow(device(admin, 'device-e2e-0002'));
    expect(result.pull.status).toBe('ok');
    expect(await db.customers.get(customerId)).toMatchObject({ full_name: 'Omar Khoury' });
    expect(await db.orders.get(order.id)).toMatchObject({ total: '24.00', payment_status: 'paid', status: 'received' });
    expect(await db.order_items.where('order_id').equals(order.id).count()).toBe(1);
    expect(await db.order_status_history.where('order_id').equals(order.id).count()).toBe(1);
    expect(await db.transactions.where('order_id').equals(order.id).count()).toBe(1);
    expect(await syncNow(device(admin, 'device-e2e-0002')).then((r) => r.pull.rows)).toBe(0);      // caught up: nothing more to send
  });

  it('a customer registered on two devices is merged automatically and no order is lost', async () => {
    const phone = '+96170777222';
    const existing = await createCustomer(admin, { full_name: 'Rana (registered first)', phone_e164: phone });      // the other device got there first

    // this device is stale: it has never seen Rana
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone, whatsappOptIn: false });
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Menus', quantity: 10, unitPrice: '3.5' }] });
    await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cash', amount: '15' });

    const result = await syncNow(device(reception));
    expect(result.pull.status).toBe('ok');
    expect(await db.outbox.count()).toBe(0);
    expect(await conflictCount()).toBe(0);                                                  // nothing for a human to sort out

    expect(await q('SELECT 1 FROM customers WHERE phone_e164 = $1', [phone])).toHaveLength(1);   // still ONE Rana on the server
    const [serverOrder] = await q<{ customer_id: string; paid_total: string; total: string }>('SELECT customer_id, paid_total::text, total::text FROM orders WHERE id = $1', [order.id]);
    expect(serverOrder).toEqual({ customer_id: existing, paid_total: '15.00', total: '35.00' });   // order and payment survived, under the existing customer
    expect(await db.customers.get(customer.id)).toBeUndefined();
    expect((await db.orders.get(order.id))!.customer_id).toBe(existing);
    expect(await db.conflicts.where('resolved').equals(1).count()).toBe(1);                       // the merge is on record
  });

  it('a payment the server refuses stops counting on the device too', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Nour', phone: '+96170888333', whatsappOptIn: false });
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Cards', quantity: 1, unitPrice: 40 }] });
    await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cash', amount: '20' });
    await syncNow(device(reception));
    expect((await db.orders.get(order.id))!).toMatchObject({ paid_total: '20.00', payment_status: 'partial' });

    // a receptionist may take money but not give it back; the app hides the button, but the rule lives on the server
    const refund = await recordPaymentLocally({ orderId: order.id, type: 'refund', method: 'cash', amount: '5' });
    expect((await db.orders.get(order.id))!.paid_total).toBe('15.00');                             // optimistic
    const result = await syncNow(device(reception));
    expect(result.push).toMatchObject({ status: 'ok', conflicts: 1 });
    expect(await db.transactions.get(refund.id)).toMatchObject({ _rejected: expect.stringContaining('forbidden') });
    expect((await db.orders.get(order.id))!).toMatchObject({ paid_total: '20.00', payment_status: 'partial' });   // back in line with the server
    expect(await q('SELECT paid_total::text FROM orders WHERE id = $1', [order.id])).toEqual([{ paid_total: '20.00' }]);
    expect(await conflictCount()).toBe(1);                                                   // waits for a manager to look at it
  });

  it('a delivery round: staff collect cash on the road with no signal, and it reaches the order once back in range', async () => {
    const customerId = await createCustomer(reception, { full_name: 'Karim Saad' });
    const order = await createOrder(reception, customerId, { fulfillment_type: 'delivery', delivery_address: 'Cedar street', items: [{ id: newId(), name_snapshot: 'Banner', quantity: 1, unit_price: 60 }] });
    await s.pool.query(`UPDATE orders SET status = 'ready' WHERE id = $1`, [order.id]);

    // out on the road, no signal: scan, collect, hand over — delivery needs no assigned person, just the order itself
    const phone = device(staff, 'device-delivery-01')
    await syncNow(phone)
    await changeOrderStatus((await db.orders.get(order.id))!, 'out_for_delivery', { source: 'scanner', barcode: order.code })
    await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cod', amount: '60' })
    await changeOrderStatus((await db.orders.get(order.id))!, 'delivered', { source: 'manual' })
    expect(await db.outbox.count()).toBe(3)

    // back in range
    const result = await syncNow(phone)
    expect(result.push).toMatchObject({ status: 'ok', applied: 3, conflicts: 0 })
    expect(await conflictCount()).toBe(0)
    expect(await q('SELECT status, payment_status, paid_total::text FROM orders WHERE id = $1', [order.id])).toEqual([{ status: 'delivered', payment_status: 'paid', paid_total: '60.00' }])
    expect(await db.orders.get(order.id)).toMatchObject({ status: 'delivered', payment_status: 'paid' })
    const history = await db.order_status_history.where('order_id').equals(order.id).toArray()
    expect(history.map((h) => h.to_status).sort()).toEqual(['delivered', 'out_for_delivery', 'received'])
    expect(await q(`SELECT collected_by, method FROM transactions WHERE order_id = $1`, [order.id])).toEqual([{ collected_by: s.fixtures.users.staff.id, method: 'cod' }])
  });

  it('cash collected on delivery is settled later from a different device, all through the real API', async () => {
    const customerId = await createCustomer(reception, { full_name: 'Hiba Fares' });
    const order = await createOrder(reception, customerId, {
      fulfillment_type: 'delivery', delivery_address: 'Cedar street',
      items: [{ id: newId(), name_snapshot: 'Roll-up banner', quantity: 1, unit_price: 75 }],
    });
    await s.pool.query(`UPDATE orders SET status = 'ready' WHERE id = $1`, [order.id]);

    // one device works the round offline
    const phone = device(staff, 'device-delivery-02')
    await syncNow(phone)
    await changeOrderStatus((await db.orders.get(order.id))!, 'out_for_delivery', { source: 'manual' })
    await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cod', amount: '75' })
    await changeOrderStatus((await db.orders.get(order.id))!, 'delivered', { source: 'manual' })
    expect((await syncNow(phone)).push).toMatchObject({ status: 'ok', conflicts: 0 })

    // back at the shop, on a different device: the cash is not yet handed over
    await Promise.all(db.tables.map((t) => t.clear()))
    const counter = device(reception, 'device-counter-01')
    await syncNow(counter)
    const rows = await unsettledCod()
    expect(rows.map((r) => r.transaction.order_id)).toContain(order.id)
    expect(await q(`SELECT settled_at FROM transactions WHERE order_id = $1`, [order.id])).toEqual([{ settled_at: null }])

    const mine = rows.find((r) => r.transaction.order_id === order.id)!
    expect(await settleCod([mine.transaction])).toBe(1)
    expect((await syncNow(counter)).push).toMatchObject({ status: 'ok', applied: 1, conflicts: 0 })

    const [settled] = await q<{ settled_by: string; settled_at: Date | null }>(`SELECT settled_by, settled_at FROM transactions WHERE order_id = $1`, [order.id])
    expect(settled!.settled_by).toBe(s.fixtures.users.receptionist.id)
    expect(settled!.settled_at).not.toBeNull()
    expect((await unsettledCod()).some((r) => r.transaction.order_id === order.id)).toBe(false)
    expect(await conflictCount()).toBe(0)
  });

  it('a clash between two staff ends in the review queue, and retrying settles it against the real server', async () => {
    const customerId = await createCustomer(reception, { full_name: 'Zeina Rahal', notes: 'first note' });
    const counter = device(reception, 'device-counter-02');
    await syncNow(counter);

    // someone else edits the same field first, from another device
    const theirs = await pushOne(admin, mutation('customers:update', customerId, { changes: { notes: 'theirs' }, base: { notes: 'first note' } }));
    expect(theirs.result).toBe('applied');

    // this device was still on the old value
    const local = (await db.customers.get(customerId))!;
    await db.customers.update(customerId, { notes: 'mine', _pending: true });
    const { newMutation } = await import('../../apps/admin/src/offline/actions');
    await db.outbox.add(newMutation('customers:update', customerId, { changes: { notes: 'mine' }, base: { notes: String(local.notes) } }));

    const clash = await syncNow(counter);
    expect(clash.push).toMatchObject({ status: 'ok', conflicts: 1 });
    expect((await db.customers.get(customerId))!.notes).toBe('theirs');              // the server's version is shown meanwhile
    const [entry] = await unresolvedConflicts();
    expect(entry).toMatchObject({ result: 'conflict', error: expect.stringContaining('notes') });

    // the person decides their change should win
    expect(await retryConflict(entry!.id)).toBe(true);
    const resolved = await syncNow(counter);
    expect(resolved.push).toMatchObject({ status: 'ok', applied: 1, conflicts: 0 });
    expect(await q('SELECT notes FROM customers WHERE id = $1', [customerId])).toEqual([{ notes: 'mine' }]);
    expect(await unresolvedConflicts()).toEqual([]);
    expect((await db.customers.get(customerId))!._pending).toBeFalsy();
  });

  it('a correction and a cancellation made offline reach the server with their reason intact', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170321654', whatsappOptIn: false });
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Flyers', quantity: 2, unitPrice: 15 }] });
    await syncNow(device(reception));

    // the customer calls back: wrong number, and they want it delivered
    await editCustomer((await db.customers.get(customer.id))!, { phone_e164: '+96170999888', city: 'Hermel' });
    await editOrder((await db.orders.get(order.id))!, { fulfillment_type: 'delivery', delivery_address: 'Cedar street', internal_notes: 'rush' });
    const sent = await syncNow(device(reception));
    expect(sent.push).toMatchObject({ status: 'ok', applied: 2, conflicts: 0 });

    expect(await q('SELECT phone_e164, city FROM customers WHERE id = $1', [customer.id])).toEqual([{ phone_e164: '+96170999888', city: 'Hermel' }]);
    expect(await q('SELECT fulfillment_type, delivery_address, internal_notes, total::text FROM orders WHERE id = $1', [order.id]))
      .toEqual([{ fulfillment_type: 'delivery', delivery_address: 'Cedar street', internal_notes: 'rush', total: '30.00' }]);   // the money was never touched

    // then they change their mind entirely
    await cancelOrder((await db.orders.get(order.id))!, 'customer changed their mind');
    const cancelled = await syncNow(device(admin, 'device-manager-01'));
    expect(cancelled.push).toMatchObject({ status: 'ok', applied: 1, conflicts: 0 });
    expect(await q('SELECT status, cancel_reason FROM orders WHERE id = $1', [order.id]))
      .toEqual([{ status: 'cancelled', cancel_reason: 'customer changed their mind' }]);
    expect(await conflictCount()).toBe(0);
  });

  it('a price set once in the catalogue is the price the order is charged, tiers included', async () => {
    const counter = device(admin, 'device-catalogue-01');
    const flyer = await createProduct({
      sku: 'FLYER-A5', name_ar: 'منشور', name_en: 'Flyer A5', pricing_model: 'tiered', base_price: '0.08',
      price_rules: [{ min_quantity: '100', unit_price: '0.06' }, { min_quantity: '500', unit_price: '0.04' }],
    });
    expect((await syncNow(counter)).push).toMatchObject({ status: 'ok', applied: 1, conflicts: 0 });
    expect(await q('SELECT base_price, pricing_model FROM products WHERE id = $1', [flyer.id]))
      .toEqual([{ base_price: '0.0800', pricing_model: 'tiered' }]);

    // a second device gets the catalogue by sync and quotes from it
    await Promise.all(db.tables.map((t) => t.clear()));
    const till = device(reception, 'device-till-01');
    await syncNow(till);
    const stored = (await db.products.get(flyer.id))!;
    expect(priceFor(stored, 1000)).toBe('0.04');

    const { customer } = await createCustomerLocally({ fullName: 'Nadia', phone: '+96170777555', whatsappOptIn: false });
    const order = await createOrderLocally({
      customerId: customer.id,
      items: [{ name: stored.name_ar, quantity: '1000', unitPrice: priceFor(stored, 1000), productId: stored.id }],
    });
    expect(order.total).toBe('40.00');
    expect((await syncNow(till)).push).toMatchObject({ status: 'ok', conflicts: 0 });
    expect(await q('SELECT total::text FROM orders WHERE id = $1', [order.id])).toEqual([{ total: '40.00' }]);
    expect(await q('SELECT product_id, unit_price::text FROM order_items WHERE order_id = $1', [order.id]))
      .toEqual([{ product_id: flyer.id, unit_price: '0.0400' }]);
  });

  it('the paper leaves the store by itself when the job reaches the press', async () => {
    const store = device(warehouse, 'device-store-01');

    // the warehouse sets up an item, receives a delivery, and writes the product's recipe
    const paper = await createInventoryItem({ sku: 'PAPER-SRA3', name_ar: 'ورق', name_en: 'Paper SRA3', category: 'paper', unit: 'sheet', reorder_level: '500' });
    await recordMovement({ itemId: paper.id, type: 'receipt', amount: '5000', unitCost: '0.012' });
    expect((await syncNow(store)).push).toMatchObject({ status: 'ok', conflicts: 0 });
    expect(await q('SELECT quantity_on_hand FROM inventory_items WHERE id = $1', [paper.id])).toEqual([{ quantity_on_hand: '5000.000' }]);

    // the catalogue belongs to the manager, the recipe to the warehouse: each is pushed by whoever may do it
    const product = await createProduct({ sku: 'POSTER', name_ar: 'ملصق', name_en: 'Poster', base_price: '2' });
    expect((await syncNow(device(admin, 'device-manager-02'))).push).toMatchObject({ status: 'ok', conflicts: 0 });
    await addRecipeLine({ productId: product.id, itemId: paper.id, quantityPerUnit: '1', wastePct: '10' });
    expect((await syncNow(store)).push).toMatchObject({ status: 'ok', conflicts: 0 });

    // the counter takes an order for 200 posters
    const { customer } = await createCustomerLocally({ fullName: 'Ziad', phone: '+96170112233', whatsappOptIn: false });
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Poster', quantity: '200', unitPrice: '2', productId: product.id }] });
    expect((await syncNow(device(reception, 'device-till-02'))).push).toMatchObject({ status: 'ok', conflicts: 0 });

    // before printing, the store can already say what the job will take
    expect(await materialsFor(product.id, 200)).toMatchObject([{ needed: 220, shortfall: 0 }]);

    // the operator starts the job, from their own device
    await Promise.all(db.tables.map((t) => t.clear()));
    const press = device(operator, 'device-press-01');
    await syncNow(press);
    await changeOrderStatus((await db.orders.get(order.id))!, 'printing', { source: 'scanner', barcode: order.public_code });
    expect((await syncNow(press)).push).toMatchObject({ status: 'ok', applied: 1, conflicts: 0 });

    // 200 x 1 sheet + 10% waste, taken out by the server, with no one remembering to
    expect(await q('SELECT quantity_on_hand FROM inventory_items WHERE id = $1', [paper.id])).toEqual([{ quantity_on_hand: '4780.000' }]);
    expect(await q(`SELECT movement_type, reason, quantity_delta::text FROM stock_movements WHERE order_id = $1`, [order.id]))
      .toEqual([{ movement_type: 'consumption', reason: 'auto:bom', quantity_delta: '-220.000' }]);

    // and the store's own device sees the new balance on its next sync
    await Promise.all(db.tables.map((t) => t.clear()));
    await syncNow(store);
    expect((await db.inventory_items.get(paper.id))!.quantity_on_hand).toBe('4780.000');
    expect(await conflictCount()).toBe(0);
  });

  it('a customer orders from the real website, and staff price the delivery and confirm it', async () => {
    // the owner puts a real product in the catalogue and staff sync it
    const flyerId = newId();
    const created = await pushOne(admin, mutation('products:insert', flyerId, {
      sku: 'E2E-FLYER', name_ar: 'منشور', name_en: 'Flyer', pricing_model: 'tiered', base_price: '0.08',
      price_rules: [{ min_quantity: '500', unit_price: '0.04' }], is_public: true, min_quantity: '100',
    } as never));
    expect(created.result).toBe('applied');

    // a customer signs up on the website, confirms their email, and places a delivery order
    const shopper = webCustomer();
    await shopper.post('/signup', { email: 'shopper@example.com', password: 'a good long password', full_name: 'Nour Aziz', locale: 'ar' });
    const verifyToken = new URL(s.linkFor('shopper@example.com')).searchParams.get('token');
    await shopper.post('/verify', { token: verifyToken });
    const placed = await jsonOf<{ code: string; total: string; deliveryFeePending: boolean }>(await shopper.post('/orders', {
      request_id: newId(), items: [{ product_id: flyerId, quantity: '500' }],
      fulfillment_type: 'delivery', delivery_address: 'شارع الاستقلال', delivery_city: 'طرابلس', payment_method: 'cod',
    }));
    expect(placed).toMatchObject({ total: '20.00', deliveryFeePending: true });   // 500 x 0.04, no delivery fee yet

    // it reaches the counter's device by sync, priced from the catalogue, waiting for a fee
    const counter = device(reception, 'device-e2e-counter');
    await syncNow(counter);
    const order = (await db.orders.where('public_code').equals(placed.code).first())!;
    expect(order).toMatchObject({ source: 'web', status: 'pending', delivery_fee_pending: true, total: '20.00' });

    // the owner prices the delivery (all of Lebanon, priced per order) through the real admin API
    await fetch(`${s.baseUrl}/api/v1/admin/orders/${order.id}/delivery-fee`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fee: '6' }),
    });
    expect(await q('SELECT total::text, delivery_fee_pending FROM orders WHERE id = $1', [order.id])).toEqual([{ total: '26.00', delivery_fee_pending: false }]);

    // now the counter can confirm it, and the customer's "my orders" reflects the real status
    const confirm = await pushOne(reception, mutation('order_status_history:status_change', newId(), { order_id: order.id, to_status: 'received', source: 'manual', occurred_at: new Date().toISOString() }));
    expect(confirm.result).toBe('applied');
    const myOrders = await jsonOf<{ code: string; status: string; total: string }[]>(await shopper.get('/orders'));
    expect(myOrders).toEqual([{ code: placed.code, number: expect.any(String), status: 'received', total: '26.00', currency: 'USD', paymentStatus: 'unpaid', placedAt: expect.any(String) }]);
    expect(await conflictCount()).toBe(0);
  });
});
