import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newCode, newId, pullAll, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

/**
 * The net under every branch_id in the codebase.
 *
 * PostgreSQL enforces this project's integrity rules — VAT, totals, the permission allow-list, invoice exclusivity —
 * but it enforces no ACCESS rules: there is no row-level security and the API connects as the database owner, so one
 * forgotten `AND branch_id = $n` in a future handler is a silent cross-branch leak with nothing behind it to catch it.
 * These tests are that net. They do not test a feature; they test an invariant that every query must keep.
 *
 * The intruder is an ADMIN of the other branch, deliberately: '*' permissions, so nothing here can pass by accident
 * because a permission check happened to refuse first. Every refusal below has to come from branch scoping itself.
 *
 * When this file fails, do not adjust the expectation — find the query that forgot its branch.
 */
describe.skipIf(!hasTestDatabase)('one branch can never reach another branch', () => {
  let s: TestServer;
  let admin: ApiClient, intruder: ApiClient;
  const main: Record<string, string> = {};

  beforeAll(async () => {
    s = await startTestServer();
    const { ensureDefaultTemplates } = await import('../src/modules/messaging/default-templates');
    await ensureDefaultTemplates(s.pool);
    admin = await s.as('admin');
    intruder = await s.as('otheradmin');          // admin of branch OTHER: every permission, no data of its own

    // A shop's day in branch MAIN: a customer, a catalogue, stock, an order, money taken, a B2B price, a quote.
    main.customer = await createCustomer(admin, { customer_type: 'b2b', company_name: 'Rafiq Press' });
    main.product = newId();
    expect((await pushOne(admin, mutation('products:insert', main.product, { sku: `ISO-${main.product.slice(-6)}`, name_ar: 'كرت', name_en: 'Card', base_price: '25' }))).result).toBe('applied');
    main.item = newId();
    expect((await pushOne(admin, mutation('inventory_items:insert', main.item, { sku: `PPR-${main.item.slice(-6)}`, name_ar: 'ورق', name_en: 'Paper', category: 'paper', unit: 'sheet' }))).result).toBe('applied');
    main.material = newId();
    expect((await pushOne(admin, mutation('product_materials:insert', main.material, { product_id: main.product, item_id: main.item, quantity_per_unit: '2' }))).result).toBe('applied');

    const order = await createOrder(admin, main.customer);
    main.order = order.id;
    main.code = order.code;
    main.txn = newId();
    expect((await pushOne(admin, mutation('transactions:insert', main.txn, { order_id: main.order, txn_type: 'payment', method: 'cod', amount: '5' }))).result).toBe('applied');
    main.override = newId();
    expect((await pushOne(admin, mutation('company_price_overrides:insert', main.override, { customer_id: main.customer, product_id: main.product, unit_price: '20' }))).result).toBe('applied');

    main.quote = (await jsonOf(await admin.post('/api/v1/admin/quotes', {
      customer_id: main.customer, valid_days: 7, items: [{ name: 'Card', quantity: '100', unit_price: '0.5' }],
    }))).id;
    main.template = (await jsonOf<{ id: string }[]>(await admin.get('/api/v1/admin/templates')))[0]!.id;
    main.orderItem = (await s.pool.query<{ id: string }>('SELECT id FROM order_items WHERE order_id = $1', [main.order])).rows[0]!.id;
  });
  afterAll(async () => { await s.close(); });

  it('a device in the other branch pulls none of it', async () => {
    const { changes } = await pullAll(intruder);
    const ids = new Set(Object.values(changes).flat().map((row) => String(row.id)));
    const leaked = Object.values(main).filter((id) => ids.has(id));
    expect(leaked, `pull leaked: ${leaked.join(', ')}`).toEqual([]);

    // Not merely "no ids in common": no row of any synced table may carry the other branch's id at all.
    const foreign = Object.values(changes).flat().filter((row) => row.branch_id && row.branch_id !== s.fixtures.otherBranchId);
    expect(foreign).toEqual([]);

    // The same pull run by MAIN's own admin does return the data, so the assertions above mean scoping, not emptiness.
    const mine = await pullAll(admin);
    const mineIds = new Set(Object.values(mine.changes).flat().map((row) => String(row.id)));
    expect(Object.values(main).filter((id) => mineIds.has(id)).length).toBeGreaterThan(0);
  });

  it('no list endpoint shows another branch its rows', async () => {
    const lists: [string, (body: any) => unknown[]][] = [     // eslint-disable-line @typescript-eslint/no-explicit-any
      ['/api/v1/admin/quotes', (b) => b],
      ['/api/v1/admin/templates', (b) => b],
      ['/api/v1/admin/content/media', (b) => b],
      ['/api/v1/admin/customer-accounts', (b) => b.accounts ?? b],
      ['/api/v1/admin/team/users', (b) => b],
      ['/api/v1/admin/team/audit-log', (b) => b.entries ?? b],
      [`/api/v1/admin/company-invoices?customer_id=${main.customer}`, (b) => b],
      [`/api/v1/admin/company-invoices/unbilled?customer_id=${main.customer}`, (b) => b],
      [`/api/v1/admin/orders/${main.order}/files`, (b) => b],
      [`/api/v1/admin/orders/${main.order}/proofs`, (b) => b],
    ];
    for (const [path, pick] of lists) {
      const res = await intruder.get(path);
      expect([200, 404], `${path} answered ${res.status}`).toContain(res.status);
      if (res.status === 404) continue;
      const rows = pick(await jsonOf(res));
      const ours = new Set(Object.values(main));
      const leaked = (Array.isArray(rows) ? rows : []).filter((r) => ours.has(String((r as { id?: string }).id)));
      expect(leaked, `${path} leaked a MAIN row`).toEqual([]);
    }
  });

  it('every report counts only the caller’s own branch', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const dashboard = await jsonOf(await intruder.get(`/api/v1/admin/reports/dashboard?date=${today}`));
    expect(JSON.stringify(dashboard)).not.toContain(main.order);
    for (const path of ['/api/v1/admin/reports/unpaid', `/api/v1/admin/reports/cash-closing?date=${today}`, '/api/v1/admin/reports/production-queue']) {
      const body = JSON.stringify(await jsonOf(await intruder.get(path)));
      for (const id of Object.values(main)) expect(body, `${path} leaked ${id}`).not.toContain(id);
    }
  });

  it('fetching one row by its id answers "not found", never the row', async () => {
    const byId = [
      `/api/v1/admin/quotes/${main.quote}`,
      `/api/v1/admin/company-invoices/${main.order}`,
      `/api/v1/admin/customer-accounts/${main.customer}`,
      `/api/v1/admin/orders/${main.order}/files/${main.orderItem}`,
    ];
    for (const path of byId) expect((await intruder.get(path)).status, path).toBe(404);
  });

  it('writing to another branch’s row is refused, and the row is untouched', async () => {
    const before = (await s.pool.query('SELECT * FROM orders WHERE id = $1', [main.order])).rows[0];

    const writes: { what: string; run: () => Promise<{ result: string }> }[] = [
      { what: 'orders:update', run: () => pushOne(intruder, mutation('orders:update', main.order!, { changes: { internal_notes: 'theirs now' }, base: { internal_notes: null } })) },
      { what: 'orders:edit_items', run: () => pushOne(intruder, mutation('orders:edit_items', main.order!, { items: [{ id: newId(), name_snapshot: 'x', quantity: '1', unit_price: '1' }] })) },
      { what: 'status_change', run: () => pushOne(intruder, mutation('order_status_history:status_change', newId(), { order_id: main.order!, to_status: 'cancelled', source: 'manual', note: 'not mine', occurred_at: new Date().toISOString() })) },
      { what: 'transactions:insert', run: () => pushOne(intruder, mutation('transactions:insert', newId(), { order_id: main.order!, txn_type: 'refund', method: 'cash', amount: '5' })) },
      { what: 'transactions:settle', run: () => pushOne(intruder, mutation('transactions:settle', main.txn!, { settled_at: new Date().toISOString() })) },
      { what: 'customers:update', run: () => pushOne(intruder, mutation('customers:update', main.customer!, { changes: { full_name: 'Taken' }, base: { full_name: 'Ali Hassan' } })) },
      { what: 'products:update', run: () => pushOne(intruder, mutation('products:update', main.product!, { changes: { base_price: '0.01' }, base: { base_price: '25.0000' } })) },
      { what: 'inventory_items:update', run: () => pushOne(intruder, mutation('inventory_items:update', main.item!, { changes: { name_ar: 'ملكي' }, base: { name_ar: 'ورق' } })) },
      { what: 'product_materials:update', run: () => pushOne(intruder, mutation('product_materials:update', main.material!, { changes: { quantity_per_unit: '99' }, base: { quantity_per_unit: '2.000' } })) },
      { what: 'product_materials:delete', run: () => pushOne(intruder, mutation('product_materials:delete', main.material!, {})) },
      { what: 'stock_movements', run: () => pushOne(intruder, mutation('stock_movements:stock_movement', newId(), { item_id: main.item!, movement_type: 'adjustment', quantity_delta: '-500', occurred_at: new Date().toISOString() })) },
      { what: 'price_override:update', run: () => pushOne(intruder, mutation('company_price_overrides:update', main.override!, { unit_price: '0.01', base: { unit_price: '20.0000' } })) },
      { what: 'price_override:delete', run: () => pushOne(intruder, mutation('company_price_overrides:delete', main.override!, {})) },
      { what: 'price_override:insert', run: () => pushOne(intruder, mutation('company_price_overrides:insert', newId(), { customer_id: main.customer!, product_id: main.product!, unit_price: '0.01' })) },
      { what: 'manual_send', run: () => pushOne(intruder, mutation('notification_logs:manual_send', newId(), { order_id: main.order!, channel: 'whatsapp', body: 'not your customer' })) },
      { what: 'orders:insert reusing their code', run: () => pushOne(intruder, mutation('orders:insert', newId(), { public_code: main.code!, customer_id: main.customer!, items: [{ id: newId(), name_snapshot: 'x', quantity: '1', unit_price: '1' }] })) },
    ];
    for (const { what, run } of writes) {
      const res = await run();
      expect(['rejected', 'conflict'], `${what} was APPLIED across branches`).toContain(res.result);
    }

    // 409 is as good a refusal as 404 here, and tells a stranger less: quotes/:id/cancel answers the same
    // "quote_not_open" whether the quote is in another branch, already closed, or has never existed.
    for (const path of [`/api/v1/admin/orders/${main.order}/delivery-fee`, `/api/v1/admin/orders/${main.order}/invoice`, `/api/v1/admin/quotes/${main.quote}/cancel`]) {
      const res = await intruder.post(path, { fee: '1' });
      expect([400, 404, 409], `${path} answered ${res.status}`).toContain(res.status);
    }
    // Valid bodies on purpose: a 400 from a rejected payload would prove nothing about branch scoping.
    const staffId = s.fixtures.users.staff.id;                       // a real user, in MAIN, not in the intruder's branch
    const posts: [string, unknown][] = [
      [`/api/v1/admin/customer-accounts/${main.customer}/deactivate`, {}],
      [`/api/v1/admin/team/users/${staffId}/reset-password`, { password: 'a long enough password' }],
      [`/api/v1/admin/team/users/${staffId}/end-sessions`, {}],
    ];
    for (const [path, body] of posts) expect((await intruder.post(path, body)).status, path).toBe(404);
    // The other branch's staff member can still sign in: nothing above reset their password or ended their sessions.
    expect(await s.as('staff')).toBeTruthy();
    const put = await fetch(`${s.baseUrl}/api/v1/admin/templates/${main.template}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${intruder.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ row_version: 1, data: { body: 'hijacked' } }),
    });
    expect(put.status).toBe(404);

    // Nothing above may have left a mark: the refusals are only worth as much as the rows behind them.
    const after = (await s.pool.query('SELECT * FROM orders WHERE id = $1', [main.order])).rows[0];
    expect(after).toEqual(before);
    expect((await s.pool.query('SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND deleted_at IS NULL', [main.order])).rows[0]!.n).toBe(1);
    expect((await s.pool.query('SELECT deleted_at FROM company_price_overrides WHERE id = $1', [main.override])).rows[0]!.deleted_at).toBeNull();
    expect((await s.pool.query('SELECT status FROM quotes WHERE id = $1', [main.quote])).rows[0]!.status).toBe('sent');
    expect((await s.pool.query('SELECT settled_at FROM transactions WHERE id = $1', [main.txn])).rows[0]!.settled_at).toBeNull();
    // Compared as numbers: what matters is that the value did not move, not how many decimals the column prints.
    expect(Number((await s.pool.query('SELECT quantity_per_unit::text FROM product_materials WHERE id = $1 AND deleted_at IS NULL', [main.material])).rows[0]!.quantity_per_unit)).toBe(2);
    expect(Number((await s.pool.query('SELECT base_price::text FROM products WHERE id = $1', [main.product])).rows[0]!.base_price)).toBe(25);
    // And above all: not one message queued to the other branch's customer.
    expect((await s.pool.query(`SELECT count(*)::int AS n FROM notification_logs WHERE created_by = $1`, [s.fixtures.users.otherAdmin.id])).rows[0]!.n).toBe(0);
  });
});
