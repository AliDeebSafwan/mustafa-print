import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, pull, pullAll, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

const ids = (rows: Record<string, unknown>[] | undefined) => (rows ?? []).map((r) => r.id as string).sort();

describe.skipIf(!hasTestDatabase)('sync pull', () => {
  let s: TestServer;
  let admin: ApiClient, reception: ApiClient, operator: ApiClient, warehouse: ApiClient, otherAdmin: ApiClient;
  const customers: string[] = [];

  beforeAll(async () => {
    s = await startTestServer();
    admin = await s.as('admin');
    reception = await s.as('receptionist');
    operator = await s.as('operator');
    warehouse = await s.as('warehouse');
    otherAdmin = await s.as('otheradmin');
    await s.pool.query(`INSERT INTO products (branch_id, sku, name_ar, name_en) VALUES ($1,'CARDS','بطاقات','Cards')`, [s.fixtures.branchId]);
    await s.pool.query(`INSERT INTO inventory_items (branch_id, sku, name_ar, name_en, category, unit) VALUES ($1,'PAPER','ورق','Paper','paper','sheet')`, [s.fixtures.branchId]);
    // "received" has a template, so creating orders below also queues a message (notification_logs is then non-empty)
    await s.pool.query(`INSERT INTO notification_templates (branch_id, template_key, channel, locale, body) VALUES ($1,'order.received','whatsapp','ar','x {{order_id}}')`, [s.fixtures.branchId]);
    for (let i = 0; i < 7; i++) customers.push(await createCustomer(reception, { full_name: `Customer ${i}` }));
    await createOrder(reception, customers[0]!);
  });
  afterAll(async () => { await s.close(); });

  it('requires authentication and a well-formed cursor', async () => {
    expect((await s.raw.get('/api/v1/sync/pull')).status).toBe(401);
    const bad = await admin.get('/api/v1/sync/pull?cursor=not-a-cursor');
    expect(bad.status).toBe(400);
    expect(await jsonOf(bad)).toMatchObject({ error: 'invalid_cursor' });
    expect((await admin.get('/api/v1/sync/pull?limit=0')).status).toBe(400);
  });

  it('sends each role only the tables it is allowed to read, with money as decimal strings', async () => {
    const tables = async (api: ApiClient) => Object.keys((await pullAll(api)).changes).sort();
    expect(await tables(admin)).toEqual(['barcodes', 'customers', 'inventory_items', 'notification_logs', 'notification_templates', 'order_items', 'order_status_history', 'orders', 'products']);
    expect(await tables(operator)).toEqual(['barcodes', 'inventory_items', 'order_items', 'order_status_history', 'orders', 'products']);   // no customers, money or messages
    expect(await tables(warehouse)).toEqual(['barcodes', 'inventory_items', 'order_items', 'order_status_history', 'orders', 'products']);
    const { changes } = await pullAll(admin);
    expect(changes.orders![0]).toMatchObject({ total: '25.00', currency: 'USD', status: 'received', order_number: '1' });
    expect(changes.orders![0]).not.toHaveProperty('sync_ts');
    expect(changes.orders![0]).not.toHaveProperty('_cursor_ts');
  });

  it('paging never loses or repeats a row, whatever the page size', async () => {
    const whole = (await pullAll(admin, undefined, 500)).changes;
    for (const limit of [1, 2, 3, 5]) {
      const paged = await pullAll(admin, undefined, limit);
      expect(paged.pages).toBeGreaterThan(1);
      for (const [entity, rows] of Object.entries(whole)) {
        expect(ids(paged.changes[entity]), `${entity} @ limit ${limit}`).toEqual(ids(rows));
        expect(new Set(ids(paged.changes[entity])).size).toBe(ids(paged.changes[entity]).length);   // no duplicates
      }
    }
  });

  it('is incremental: once caught up nothing is sent, and only later changes come through', async () => {
    const first = await pullAll(admin);
    const idle = await pull(admin, first.cursor);
    expect(idle).toMatchObject({ changes: {}, hasMore: false });

    const r = await pushOne(reception, mutation('customers:update', customers[3]!, { changes: { notes: 'VIP' }, base: { notes: null } }));
    expect(r.result).toBe('applied');
    const next = await pullAll(admin, first.cursor);
    expect(Object.keys(next.changes)).toEqual(['customers']);
    expect(ids(next.changes.customers)).toEqual([customers[3]]);
    expect(next.changes.customers![0]).toMatchObject({ notes: 'VIP' });
  });

  it('keeps microsecond precision in cursors so rows are never skipped or re-sent at the boundary', async () => {
    const { cursor } = await pullAll(admin);
    const positions = JSON.parse(Buffer.from(cursor, 'base64url').toString()).t as Record<string, { ts: string }>;
    for (const p of Object.values(positions)) expect(p.ts).toMatch(/\.\d{6}Z$/);
  });

  it('delivers deletions as tombstones', async () => {
    const { cursor } = await pullAll(admin);
    await s.pool.query(`UPDATE customers SET deleted_at = clock_timestamp() WHERE id = $1`, [customers[6]]);
    const { changes } = await pullAll(admin, cursor);
    expect(changes.customers).toHaveLength(1);
    expect(changes.customers![0]).toMatchObject({ id: customers[6] });
    expect(changes.customers![0]!.deleted_at).toBeTruthy();
  });

  it('never leaks another branch', async () => {
    const theirCustomer = await createCustomer(otherAdmin, { full_name: 'Other branch customer' });
    const { changes } = await pullAll(otherAdmin);
    expect(ids(changes.customers)).toEqual([theirCustomer]);
    expect(changes.orders).toBeUndefined();
    expect(ids((await pullAll(admin)).changes.customers)).not.toContain(theirCustomer);
  });

  it('never sends a staff-account secret to a device, whatever the table', async () => {
    // A customer's own email IS business data the shop needs; these are the columns that must never leave the server.
    const forbidden = ['password_hash', 'token_version', 'token_hash', 'role_id', 'last_login_at', 'refresh_token'];
    for (const [entity, rows] of Object.entries((await pullAll(admin)).changes)) {
      for (const row of rows) expect(forbidden.filter((k) => k in row), entity).toEqual([]);
    }
  });

});

describe.skipIf(!hasTestDatabase)('sync pull visibility lag', () => {
  let s: TestServer;
  beforeAll(async () => { s = await startTestServer({ SYNC_PULL_LAG_SECONDS: '5' }); });
  afterAll(async () => { await s.close(); });

  it('holds back rows changed in the last few seconds, then releases them (a slow commit is never skipped)', async () => {
    const admin = await s.as('admin');
    const reception = await s.as('receptionist');
    const id = await createCustomer(reception);
    expect((await pullAll(admin)).changes.customers).toBeUndefined();

    await s.pool.query('ALTER TABLE customers DISABLE TRIGGER trg_sync_touch');
    await s.pool.query(`UPDATE customers SET updated_at = clock_timestamp() - interval '10 seconds' WHERE id = $1`, [id]);
    await s.pool.query('ALTER TABLE customers ENABLE TRIGGER trg_sync_touch');
    expect(ids((await pullAll(admin)).changes.customers)).toEqual([id]);
  });
});
