import { canTransition, hasPermission, isOrderStatus, whyCannotSetStatus } from '@mpe/shared';
import { logAudit } from '../../audit/audit';
import { enqueueOrderNotification } from '../../messaging/enqueue';
import { lockOrder, type DbRow } from './common';
import { MutationConflict, MutationRejected, type Handler, type HandlerContext } from './types';

/**
 * Moves an order to a new status. The device may have decided offline, so the server re-checks everything:
 * the role's allowed statuses, the state machine, and the order's CURRENT status (another device may have moved it).
 */
export const changeOrderStatus: Handler<'order_status_history:status_change'> = async (ctx, { entityId, payload: p }) => {
  const { client, auth } = ctx;
  const to = p.to_status;

  const denied = whyCannotSetStatus(auth.role, to);             // the same rule the staff app uses to hide buttons
  if (denied) throw new MutationRejected('forbidden', denied);

  const order = await lockOrder(ctx, p.order_id);
  if (order.status === to) return { row: order, rowEntity: 'orders' };                 // someone got there first: same outcome
  if (!isOrderStatus(order.status) || !canTransition(order.status, to)) {
    throw new MutationConflict(`cannot move an order from ${order.status} to ${to}`, order, 'orders');
  }

  if (to === 'received' && order.delivery_fee_pending) {
    // The customer must know the full price before the shop commits to the job.
    throw new MutationConflict('set the delivery fee before confirming this order', order, 'orders');
  }

  if (to === 'printing') await assertDepositMet(ctx, order, p.note ?? null);

  let barcodeId: string | null = null;
  if (p.barcode_code) {
    const found = await client.query<{ id: string }>(
      'SELECT id FROM barcodes WHERE branch_id = $1 AND order_id = $2 AND code = $3 AND deleted_at IS NULL', [auth.branchId, order.id, p.barcode_code]);
    barcodeId = found.rows[0]?.id ?? null;
  }

  await client.query(
    `INSERT INTO order_status_history (id, branch_id, order_id, from_status, to_status, source, barcode_id, changed_by, note, device_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, LEAST($11::timestamptz, clock_timestamp()))
     ON CONFLICT (id) DO NOTHING`,
    [entityId, auth.branchId, order.id, order.status, to, p.source, barcodeId, auth.userId, p.note ?? null, ctx.deviceId, p.occurred_at]);

  const updated = await client.query<DbRow>(
    `UPDATE orders SET status = $3, cancel_reason = CASE WHEN $3 = 'cancelled' THEN $4 ELSE cancel_reason END
      WHERE id = $1 AND branch_id = $2 RETURNING *`, [order.id, auth.branchId, to, p.note ?? null]);

  if (to === 'printing') await deductMaterials(ctx, order.id, entityId);   // entityId is this status change: one deduction per entry

  await enqueueOrderNotification(client, order.id, to, { publicWebUrl: ctx.publicWebUrl });   // queued with the change, sent by the worker
  return { row: updated.rows[0], rowEntity: 'orders' };
};

/**
 * A deposit the shop may require before committing paper and time to a job. Off by default (deposit_percent = 0);
 * when set, it applies to every order unless a threshold is also set, in which case only orders at or above that
 * amount need one. An admin may override it, but only with a reason — recorded in the audit log, because skipping
 * a deposit the owner asked for is exactly the kind of thing they will want to be able to look up later.
 */
async function assertDepositMet(ctx: HandlerContext, order: DbRow, note: string | null): Promise<void> {
  const { client, auth } = ctx;
  const { rows } = await client.query<{ deposit_percent: string; deposit_threshold: string | null }>(
    'SELECT deposit_percent::text, deposit_threshold::text FROM branches WHERE id = $1', [auth.branchId]);
  const branch = rows[0]!;
  const percent = Number(branch.deposit_percent);
  if (percent <= 0) return;
  const threshold = branch.deposit_threshold === null ? null : Number(branch.deposit_threshold);
  const total = Number(order.total);
  if (threshold !== null && total < threshold) return;

  const required = Math.round(total * percent) / 100;
  const paid = Number(order.paid_total ?? 0);
  if (paid >= required) return;

  const owed = Math.round((required - paid) * 100) / 100;
  if (!hasPermission(auth.role.permissions, 'orders:deposit:override')) {
    throw new MutationConflict(`a deposit of ${owed.toFixed(2)} is required before printing`, order, 'orders');
  }
  if (!note?.trim()) throw new MutationRejected('invalid_payload', 'a reason is required to override the deposit requirement');
  await logAudit(client, auth, 'order.deposit_overridden', { type: 'order', id: order.id as string }, { required: owed.toFixed(2), reason: note.trim() });
}

/**
 * Takes the materials a job needs out of the store the moment it starts printing, from each product's recipe:
 *   consumed = line quantity x quantity per unit x (1 + waste %)
 *
 * It runs in the same transaction as the status change, so a job can never be "printing" with the paper still on the
 * books. A job sent back to the press (a reprint) consumes again, because it really does; a product with no recipe
 * consumes nothing.
 *
 * Running twice for the SAME status change cannot happen here — a mutation is applied once, and an order already
 * printing returns earlier — and a unique index on (order line, item, event) guarantees it at the database level.
 * That violation is deliberately NOT swallowed: if it ever fires, something is wrong and the shop should see it
 * rather than quietly print with stock that was never deducted.
 * The balance is allowed to go negative: the shop needs to see that it printed with stock it had not recorded,
 * not to be blocked in the middle of a job.
 */
async function deductMaterials(ctx: HandlerContext, orderId: string, eventId: string): Promise<void> {
  await ctx.client.query(
    `INSERT INTO stock_movements (branch_id, item_id, movement_type, quantity_delta, order_id, order_item_id, reason, created_by, device_id, source_event_id)
     SELECT $1, m.item_id, 'consumption',
            -round(i.quantity * m.quantity_per_unit * (1 + m.waste_pct / 100), 3),
            i.order_id, i.id, 'auto:bom', $3, $4, $5
       FROM order_items i
       JOIN product_materials m ON m.product_id = i.product_id AND m.branch_id = i.branch_id AND m.deleted_at IS NULL
      WHERE i.order_id = $2 AND i.branch_id = $1 AND i.deleted_at IS NULL
        AND (m.option_match IS NULL OR i.options @> m.option_match)
        AND round(i.quantity * m.quantity_per_unit * (1 + m.waste_pct / 100), 3) > 0`,
    [ctx.auth.branchId, orderId, ctx.auth.userId, ctx.deviceId, eventId]);
}
