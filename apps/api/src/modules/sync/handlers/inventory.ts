import { applyPatch, requirePermission, type DbRow } from './common';
import { MutationRejected, type Handler } from './types';

/**
 * What the store keeps. The balance (`quantity_on_hand`) is never written here: it belongs to the ledger, and the
 * database refuses a direct write to it. Creating an item therefore starts it at zero; an opening balance is a movement.
 */
export const insertInventoryItem: Handler<'inventory_items:insert'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'inventory:manage');
  const { client, auth } = ctx;

  const inserted = await client.query<DbRow>(
    `INSERT INTO inventory_items (id, branch_id, sku, name_ar, name_en, category, unit, reorder_level, reorder_quantity,
                                  cost_per_unit, supplier_name, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7, round($8::numeric, 3), $9, $10, $11, $12)
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    [entityId, auth.branchId, p.sku, p.name_ar, p.name_en, p.category, p.unit, p.reorder_level ?? '0',
     p.reorder_quantity ?? null, p.cost_per_unit ?? null, p.supplier_name ?? null, p.is_active ?? true]);
  if (inserted.rows[0]) return { row: inserted.rows[0] };

  const { rows } = await client.query<DbRow>('SELECT * FROM inventory_items WHERE id = $1 AND branch_id = $2', [entityId, auth.branchId]);
  if (!rows[0]) throw new MutationRejected('id_in_use');
  return { row: rows[0] };
};

export const updateInventoryItem: Handler<'inventory_items:update'> = async (ctx, { entityId, payload: { changes, base } }) => {
  requirePermission(ctx, 'inventory:manage');
  const row = await applyPatch(ctx, { table: 'inventory_items', id: entityId, changes, base });
  return { row };
};
