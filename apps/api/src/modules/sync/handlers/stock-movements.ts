import type { Permission, STOCK_MOVEMENT_TYPES } from '@mpe/shared';
import { assertIdIsOurs, requirePermission, type DbRow } from './common';
import type { Handler } from './types';

const PERMISSION_BY_TYPE: Record<(typeof STOCK_MOVEMENT_TYPES)[number], Permission> = {
  consumption: 'inventory:consume',
  waste: 'inventory:consume',
  receipt: 'inventory:receive',
  return: 'inventory:receive',
  adjustment: 'inventory:adjust',
  opening_balance: 'inventory:adjust',
};

/**
 * Appends to the stock ledger; the balance is derived by the database. Deltas commute, so two devices consuming
 * paper offline never conflict. The answer is the item's balance after the movement.
 */
export const recordStockMovement: Handler<'stock_movements:stock_movement'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, PERMISSION_BY_TYPE[p.movement_type]);
  const { client, auth } = ctx;

  const inserted = await client.query(
    `INSERT INTO stock_movements (id, branch_id, item_id, movement_type, quantity_delta, unit_cost, order_id, order_item_id, reason, occurred_at, created_by, device_id)
     VALUES ($1,$2,$3,$4, round($5::numeric, 3), $6, $7,$8,$9, LEAST($10::timestamptz, clock_timestamp()), $11,$12)
     ON CONFLICT (id) DO NOTHING`,
    [entityId, auth.branchId, p.item_id, p.movement_type, p.quantity_delta, p.unit_cost ?? null, p.order_id ?? null, p.order_item_id ?? null,
     p.reason ?? null, p.occurred_at, auth.userId, ctx.deviceId]);
  if (!inserted.rowCount) await assertIdIsOurs(ctx, 'stock_movements', entityId);

  const { rows } = await client.query<DbRow>('SELECT * FROM inventory_items WHERE id = $1 AND branch_id = $2', [p.item_id, auth.branchId]);
  return { row: rows[0], rowEntity: 'inventory_items' };
};
