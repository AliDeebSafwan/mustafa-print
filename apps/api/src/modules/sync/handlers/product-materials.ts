import { applyPatch, requirePermission, type DbRow } from './common';
import { MutationRejected, type Handler } from './types';

/**
 * A product's recipe: how much of each stored item one unit of it eats. This is what lets the shop deduct materials
 * automatically when a job starts printing, instead of someone remembering to.
 */
export const insertProductMaterial: Handler<'product_materials:insert'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'inventory:manage');
  const { client, auth } = ctx;

  const inserted = await client.query<DbRow>(
    `INSERT INTO product_materials (id, branch_id, product_id, item_id, quantity_per_unit, waste_pct, notes)
     VALUES ($1,$2,$3,$4, round($5::numeric, 6), round($6::numeric, 2), $7)
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    [entityId, auth.branchId, p.product_id, p.item_id, p.quantity_per_unit, p.waste_pct ?? '0', p.notes ?? null]);
  if (inserted.rows[0]) return { row: inserted.rows[0] };

  const { rows } = await client.query<DbRow>('SELECT * FROM product_materials WHERE id = $1 AND branch_id = $2', [entityId, auth.branchId]);
  if (!rows[0]) throw new MutationRejected('id_in_use');
  return { row: rows[0] };
};

export const updateProductMaterial: Handler<'product_materials:update'> = async (ctx, { entityId, payload: { changes, base } }) => {
  requirePermission(ctx, 'inventory:manage');
  const row = await applyPatch(ctx, { table: 'product_materials', id: entityId, changes, base });
  return { row };
};

/**
 * Removing a line from a recipe. It is marked deleted rather than erased, so devices learn about it on their next
 * sync and past deductions keep pointing at something real.
 */
export const deleteProductMaterial: Handler<'product_materials:delete'> = async (ctx, { entityId }) => {
  requirePermission(ctx, 'inventory:manage');
  const { rows } = await ctx.client.query<DbRow>(
    `UPDATE product_materials SET deleted_at = coalesce(deleted_at, clock_timestamp())
      WHERE id = $1 AND branch_id = $2 RETURNING *`, [entityId, ctx.auth.branchId]);
  if (!rows[0]) throw new MutationRejected('not_found');
  return { row: rows[0] };
};
