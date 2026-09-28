import { discountExceedsCap, hasPermission } from '@mpe/shared';
import { enqueueOrderNotification } from '../../messaging/enqueue';
import { applyPatch, requirePermission, type DbRow } from './common';
import { MutationRejected, type Handler, type HandlerContext } from './types';

const TERMINAL = new Set(['delivered', 'cancelled']);

/**
 * Creates the order, its items, the order barcode and its first status entry, and queues the "order received"
 * message, all in ONE transaction. Totals are computed here, in exact decimal arithmetic: the device's numbers are never trusted.
 */
export const insertOrder: Handler<'orders:insert'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'orders:create');
  const { client, auth } = ctx;

  await client.query(
    `INSERT INTO orders (id, branch_id, public_code, customer_id, source, status, fulfillment_type, delivery_address, delivery_city, delivery_notes,
                         payment_method, currency, customer_notes, internal_notes, due_at, created_by, origin_device_id)
     VALUES ($1,$2,$3,$4,'staff','received',$5,$6,$7,$8,$9, COALESCE($10, (SELECT base_currency FROM branches WHERE id = $2)), $11,$12,$13,$14,$15)`,
    [entityId, auth.branchId, p.public_code, p.customer_id, p.fulfillment_type ?? 'pickup', p.delivery_address ?? null, p.delivery_city ?? null,
     p.delivery_notes ?? null, p.payment_method ?? 'cod', p.currency ?? null, p.customer_notes ?? null, p.internal_notes ?? null,
     p.due_at ?? null, auth.userId, ctx.deviceId]);

  for (const [index, item] of p.items.entries()) {
    await client.query(
      `INSERT INTO order_items (id, branch_id, order_id, product_id, sort_order, name_snapshot, unit, quantity, unit_price, discount, line_total, options, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7, round($8::numeric, 3), round($9::numeric, 4), round($10::numeric, 2),
               round(round($8::numeric, 3) * round($9::numeric, 4), 2) - round($10::numeric, 2), $11::jsonb, $12)`,
      [item.id, auth.branchId, entityId, item.product_id ?? null, item.sort_order ?? index, item.name_snapshot, item.unit ?? 'piece',
       item.quantity, item.unit_price, item.discount ?? '0', JSON.stringify(item.options ?? {}), item.notes ?? null]);
  }

  // What was taken off the lines plus what is taken off the order, against what the shop allows for this role.
  const given = await client.query<{ subtotal: string; discount: string; cap: string | null }>(
    `SELECT (coalesce(sum(i.line_total), 0) + coalesce(sum(i.discount), 0))::text AS subtotal,
            (coalesce(sum(i.discount), 0) + round($3::numeric, 2))::text          AS discount,
            (SELECT max_discount_percent::text FROM branches WHERE id = $2)       AS cap
       FROM order_items i WHERE i.order_id = $1 AND i.deleted_at IS NULL`,
    [entityId, auth.branchId, p.discount_total ?? '0']);
  const { subtotal: beforeDiscount, discount: givenDiscount, cap } = given.rows[0]!;
  if (!hasPermission(auth.role.permissions, 'orders:discount:override') &&
      discountExceedsCap(beforeDiscount, givenDiscount, cap === null ? null : Number(cap))) {
    throw new MutationRejected('discount_too_large', `this shop allows at most ${cap}% without a manager`);
  }

  const totals = await client.query<DbRow>(
    `UPDATE orders o
        SET subtotal = s.subtotal, discount_total = round($3::numeric, 2), delivery_fee = round($4::numeric, 2),
            tax_total = s.tax, total = s.subtotal - round($3::numeric, 2) + round($4::numeric, 2) + s.tax
       FROM (
         SELECT coalesce(sum(line_total), 0) AS subtotal,
                branch_vat_amount($2, coalesce(sum(line_total), 0) - round($3::numeric, 2) + round($4::numeric, 2)) AS tax
           FROM order_items WHERE order_id = $1 AND deleted_at IS NULL
       ) s
      WHERE o.id = $1 AND o.branch_id = $2
      RETURNING o.*`,
    [entityId, auth.branchId, p.discount_total ?? '0', p.delivery_fee ?? '0']);

  await assertWithinCreditLimit(ctx, p.customer_id, entityId, Number(totals.rows[0]!.total));

  await client.query(
    `INSERT INTO barcodes (branch_id, order_id, label_type, code, symbology) VALUES ($1, $2, 'order', $3, 'qr')`, [auth.branchId, entityId, p.public_code]);
  await client.query(
    `INSERT INTO order_status_history (branch_id, order_id, from_status, to_status, source, changed_by, device_id)
     VALUES ($1, $2, NULL, 'received', 'manual', $3, $4)`, [auth.branchId, entityId, auth.userId, ctx.deviceId]);
  await enqueueOrderNotification(client, entityId, 'received', { publicWebUrl: ctx.publicWebUrl });

  return { row: totals.rows[0] };
};

/**
 * A customer with a credit limit (null means none, the default for everyone) may not owe the shop more than that
 * across every unpaid order at once. Checked against the balance AFTER this new order, so the order that would
 * cross the line is the one that needs the override — not a surprise on some later, unrelated order.
 */
export async function assertWithinCreditLimit(ctx: HandlerContext, customerId: string, newOrderId: string, newOrderTotal: number): Promise<void> {
  const { client, auth } = ctx;
  const { rows: [customer] } = await client.query<{ credit_limit: string | null }>(
    'SELECT credit_limit::text FROM customers WHERE id = $1 AND branch_id = $2', [customerId, auth.branchId]);
  if (!customer?.credit_limit) return;

  const { rows: [existing] } = await client.query<{ outstanding: string }>(
    `SELECT coalesce(sum(total - paid_total), 0)::text AS outstanding FROM orders
      WHERE customer_id = $1 AND branch_id = $2 AND status != 'cancelled' AND id != $3`, [customerId, auth.branchId, newOrderId]);
  const projected = Number(existing!.outstanding) + newOrderTotal;
  if (projected <= Number(customer.credit_limit)) return;

  if (!hasPermission(auth.role.permissions, 'orders:credit:override')) {
    throw new MutationRejected('credit_limit_exceeded', `this customer's credit limit is ${customer.credit_limit}; this order would bring what they owe to ${projected.toFixed(2)}`);
  }
}

export const updateOrder: Handler<'orders:update'> = async (ctx, { entityId, payload: { changes, base } }) => {
  requirePermission(ctx, 'orders:update');
  const row = await applyPatch(ctx, {
    table: 'orders', id: entityId, changes, base,
    guard: (current) => { if (TERMINAL.has(String(current.status))) throw new MutationRejected('order_closed'); },
  });
  return { row };
};
