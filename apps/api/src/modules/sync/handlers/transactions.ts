import { assertIdIsOurs, lockOrder, requirePermission, type DbRow } from './common';
import { MutationRejected, type Handler } from './types';

/**
 * Records cash taken at the counter or collected on delivery (COD), or a refund. The database trigger then updates the order's
 * paid_total and payment_status. Online wallet payments are recorded by the server from provider webhooks, never by a device.
 */
export const recordTransaction: Handler<'transactions:insert'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, p.txn_type === 'refund' ? 'transactions:refund' : 'transactions:collect');
  const { client, auth } = ctx;

  const order = await lockOrder(ctx, p.order_id);
  if (p.txn_type === 'payment' && order.status === 'cancelled') throw new MutationRejected('order_cancelled');
  if (p.txn_type === 'refund') {
    const { rows } = await client.query<{ too_much: boolean }>('SELECT round($1::numeric, 2) > paid_total AS too_much FROM orders WHERE id = $2', [p.amount, order.id]);
    if (rows[0]?.too_much) throw new MutationRejected('refund_exceeds_paid');
  }

  const inserted = await client.query<DbRow>(
    `INSERT INTO transactions (id, branch_id, order_id, customer_id, txn_type, method, status, amount, currency, collected_by, collected_at, note, created_by, device_id)
     VALUES ($1,$2,$3,$4,$5,$6,'completed', round($7::numeric, 2), $8, $9, LEAST(COALESCE($10::timestamptz, clock_timestamp()), clock_timestamp()), $11, $9, $12)
     ON CONFLICT (id) DO NOTHING RETURNING *`,
    [entityId, auth.branchId, order.id, order.customer_id, p.txn_type, p.method, p.amount, order.currency, auth.userId, p.collected_at ?? null, p.note ?? null, ctx.deviceId]);
  if (inserted.rows[0]) return { row: inserted.rows[0] };

  await assertIdIsOurs(ctx, 'transactions', entityId);
  return { row: (await client.query<DbRow>('SELECT * FROM transactions WHERE id = $1', [entityId])).rows[0] };
};

/**
 * Marks COD cash as handed over to the shop. One transaction per mutation, so someone handing over only part of the
 * money has exactly that recorded. Settling something already settled is not an error: the outcome is the same.
 */
export const settleTransaction: Handler<'transactions:settle'> = async (ctx, { entityId, payload }) => {
  requirePermission(ctx, 'transactions:settle');
  const { client, auth } = ctx;

  const { rows } = await client.query<DbRow>(
    'SELECT * FROM transactions WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [entityId, auth.branchId]);
  const txn = rows[0];
  if (!txn) throw new MutationRejected('transaction_not_found');
  if (txn.method !== 'cod' || txn.txn_type !== 'payment' || txn.status !== 'completed') throw new MutationRejected('not_settleable');
  if (txn.settled_at) return { row: txn };

  const updated = await client.query<DbRow>(
    `UPDATE transactions SET settled_at = LEAST($3::timestamptz, clock_timestamp()), settled_by = $4
      WHERE id = $1 AND branch_id = $2 RETURNING *`, [entityId, auth.branchId, payload.settled_at, auth.userId]);
  return { row: updated.rows[0] };
};
