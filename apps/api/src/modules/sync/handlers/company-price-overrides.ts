import { applyPatch, requirePermission, type DbRow } from './common';
import { MutationRejected, type Handler } from './types';

/**
 * A company's own agreed price for a product. Advisory: the staff app shows it as the suggested price when adding
 * that item to an order for that customer, but nothing stops a different price being typed — this is a price list,
 * not a lock.
 */
export const insertPriceOverride: Handler<'company_price_overrides:insert'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'customers:write');
  const { client, auth } = ctx;

  const [customer, existing] = await Promise.all([
    client.query('SELECT 1 FROM customers WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL', [p.customer_id, auth.branchId]),
    client.query('SELECT id FROM company_price_overrides WHERE customer_id = $1 AND product_id = $2 AND deleted_at IS NULL', [p.customer_id, p.product_id]),
  ]);
  if (!customer.rowCount) throw new MutationRejected('not_found', 'customer');
  if (existing.rows[0]) throw new MutationRejected('already_exists', `this customer already has a price for that product (id ${existing.rows[0].id as string})`);

  const inserted = await client.query<DbRow>(
    `INSERT INTO company_price_overrides (id, branch_id, customer_id, product_id, unit_price)
     VALUES ($1,$2,$3,$4, round($5::numeric, 4)) ON CONFLICT (id) DO NOTHING RETURNING *`,
    [entityId, auth.branchId, p.customer_id, p.product_id, p.unit_price]);
  if (inserted.rows[0]) return { row: inserted.rows[0] };

  const { rows } = await client.query<DbRow>('SELECT * FROM company_price_overrides WHERE id = $1 AND branch_id = $2', [entityId, auth.branchId]);
  if (!rows[0]) throw new MutationRejected('id_in_use');
  return { row: rows[0] };                                        // the same override sent again: nothing to change
};

export const updatePriceOverride: Handler<'company_price_overrides:update'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'customers:write');
  const row = await applyPatch(ctx, {
    table: 'company_price_overrides', id: entityId, changes: { unit_price: p.unit_price }, base: p.base,
  });
  return { row };
};

export const deletePriceOverride: Handler<'company_price_overrides:delete'> = async (ctx, { entityId }) => {
  requirePermission(ctx, 'customers:write');
  const { rows } = await ctx.client.query<DbRow>(
    `UPDATE company_price_overrides SET deleted_at = coalesce(deleted_at, clock_timestamp())
      WHERE id = $1 AND branch_id = $2 RETURNING *`, [entityId, ctx.auth.branchId]);
  if (!rows[0]) throw new MutationRejected('not_found');
  return { row: rows[0] };
};
