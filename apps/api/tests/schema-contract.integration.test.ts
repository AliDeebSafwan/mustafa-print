import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mutationSchema } from '@mpe/shared';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/test-db';

/**
 * Some rules exist twice on purpose: once in the database (a CHECK the server cannot bypass) and once in the shared
 * schema the devices are typed against. These tests fail the moment the two drift apart — the failure mode is
 * otherwise a 500 in the shop, long after the code was written.
 */
describe.skipIf(!hasTestDatabase)('database constraints match the shared contract', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await createTestDatabase(); });
  afterAll(async () => { await db.drop(); });

  /** The values a CHECK of the form `col IN ('a','b')` accepts. */
  const checkValues = async (table: string, constraint: string): Promise<string[]> => {
    const { rows } = await db.pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = $1 AND c.conname = $2`, [table, constraint]);
    expect(rows[0], `${table}.${constraint} is missing`).toBeDefined();
    return [...rows[0]!.def.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
  };

  it('refuses to deduct the same materials twice for one trip to the press', async () => {
    // The application cannot reach this, but the guarantee belongs in the database, so it is tested there.
    const ids = await db.pool.query<{ branch_id: string; item_id: string; order_id: string; order_item_id: string; event_id: string }>(`
      WITH b AS (INSERT INTO branches (code, name_ar, name_en) VALUES ('BOM', 'BOM', 'BOM') RETURNING id),
           r AS (INSERT INTO roles (key, name_ar, name_en, permissions) VALUES ('admin', 'مدير', 'Admin', '{*}') RETURNING id),
           u AS (INSERT INTO users (branch_id, role_id, full_name, email) SELECT b.id, r.id, 'U', 'u@test' FROM b, r RETURNING id, branch_id),
           c AS (INSERT INTO customers (branch_id, full_name, phone_e164) SELECT id, 'C', '+96170000001' FROM b RETURNING id),
           i AS (INSERT INTO inventory_items (branch_id, sku, name_ar, name_en, category, unit) SELECT id, 'P', 'و', 'P', 'paper', 'sheet' FROM b RETURNING id),
           o AS (INSERT INTO orders (branch_id, public_code, customer_id, created_by) SELECT b.id, 'K7M2Q9X4TB3D', c.id, u.id FROM b, c, u RETURNING id),
           li AS (INSERT INTO order_items (branch_id, order_id, name_snapshot, quantity, unit_price, line_total)
                  SELECT b.id, o.id, 'L', 1, 1, 1 FROM b, o RETURNING id),
           h AS (INSERT INTO order_status_history (branch_id, order_id, to_status, source, changed_by)
                 SELECT b.id, o.id, 'printing', 'manual', u.id FROM b, o, u RETURNING id)
      SELECT b.id AS branch_id, i.id AS item_id, o.id AS order_id, li.id AS order_item_id, h.id AS event_id FROM b, i, o, li, h`);
    const { branch_id, item_id, order_id, order_item_id, event_id } = ids.rows[0]!;
    const deduct = () => db.pool.query(
      `INSERT INTO stock_movements (branch_id, item_id, movement_type, quantity_delta, order_id, order_item_id, reason, source_event_id)
       VALUES ($1, $2, 'consumption', -5, $3, $4, 'auto:bom', $5)`, [branch_id, item_id, order_id, order_item_id, event_id]);

    await deduct();
    await expect(deduct()).rejects.toMatchObject({ code: '23505' });
    // a different trip to the press is a different event, and deducts normally
    const other = await db.pool.query<{ id: string }>(
      `INSERT INTO order_status_history (branch_id, order_id, to_status, source) VALUES ($1, $2, 'printing', 'manual') RETURNING id`, [branch_id, order_id]);
    await expect(db.pool.query(
      `INSERT INTO stock_movements (branch_id, item_id, movement_type, quantity_delta, order_id, order_item_id, reason, source_event_id)
       VALUES ($1, $2, 'consumption', -5, $3, $4, 'auto:bom', $5)`, [branch_id, item_id, order_id, order_item_id, other.rows[0]!.id])).resolves.toBeDefined();
  });

  it('every table with the shared sync trigger has the columns that trigger writes', async () => {
    // A table missing one of these accepts inserts but fails on its first update, long after the migration "worked".
    const { rows } = await db.pool.query<{ table: string; missing: string[] }>(`
      SELECT c.relname AS table,
             array(SELECT col FROM unnest(ARRAY['created_at', 'updated_at', 'row_version']) AS col
                    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_name = c.relname AND ic.column_name = col)) AS missing
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = 'trg_sync_touch'`);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => r.missing.length > 0)).toEqual([]);
  });

  it('accepts exactly the mutation operations the clients can send', async () => {
    const inSchema = [...mutationSchema.shape.op.options].sort();
    expect(await checkValues('client_mutations', 'client_mutations_op_check')).toEqual(inSchema);
  });

  it('carries no leftover legacy_id/legacy_source columns from a predecessor system that never existed', async () => {
    const { rows } = await db.pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('legacy_id', 'legacy_source') ORDER BY table_name, column_name`);
    expect(rows).toEqual([]);
  });
});
