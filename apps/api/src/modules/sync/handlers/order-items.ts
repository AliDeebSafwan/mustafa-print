import { discountExceedsCap, hasPermission } from '@mpe/shared';
import { logAudit } from '../../audit/audit';
import { lockOrder, requirePermission, type DbRow } from './common';
import { assertWithinCreditLimit } from './orders';
import { MutationConflict, MutationRejected, type Handler } from './types';

/** An order this far along has likely already had material deducted from stock for it; changing what was
 *  ordered without also touching that inventory movement would make the two disagree. */
const TERMINAL = new Set(['delivered', 'cancelled']);
const IN_PRODUCTION = new Set(['printing', 'finishing', 'ready', 'out_for_delivery']);

/**
 * Replaces an order's item list (and, optionally, its discount) — the fix for "the customer ordered the wrong
 * quantity" that today means cancelling the order and starting over. The server recomputes every total from the
 * new lines, in exact decimal arithmetic, the same as at creation; the device's own numbers are never trusted.
 */
export const editOrderItems: Handler<'orders:edit_items'> = async (ctx, { entityId, payload: p }) => {
  requirePermission(ctx, 'orders:update');
  const { client, auth } = ctx;

  const order = await lockOrder(ctx, entityId);
  if (TERMINAL.has(String(order.status))) throw new MutationRejected('order_closed');

  const inProduction = IN_PRODUCTION.has(String(order.status));
  const hasPayment = Number(order.paid_total ?? 0) > 0;
  const hasInvoice = Boolean(order.invoice_number);
  if (inProduction || hasPayment || hasInvoice) {
    if (!hasPermission(auth.role.permissions, 'orders:items:override')) {
      const why = inProduction ? 'cannot edit items after production has started'
        : hasPayment ? 'cannot edit items after a payment has been recorded' : 'cannot edit items after the invoice was issued';
      throw new MutationConflict(why, order, 'orders');
    }
    if (!p.override_reason?.trim()) {
      throw new MutationRejected('invalid_payload', 'a reason is required to edit items after production has started, a payment was recorded, or the invoice was issued');
    }
  }

  await client.query('UPDATE order_items SET deleted_at = clock_timestamp() WHERE order_id = $1 AND deleted_at IS NULL', [entityId]);
  for (const [index, item] of p.items.entries()) {
    await client.query(
      `INSERT INTO order_items (id, branch_id, order_id, product_id, sort_order, name_snapshot, unit, quantity, unit_price, discount, line_total, options, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7, round($8::numeric, 3), round($9::numeric, 4), round($10::numeric, 2),
               round(round($8::numeric, 3) * round($9::numeric, 4), 2) - round($10::numeric, 2), $11::jsonb, $12)`,
      [item.id, auth.branchId, entityId, item.product_id ?? null, item.sort_order ?? index, item.name_snapshot, item.unit ?? 'piece',
       item.quantity, item.unit_price, item.discount ?? '0', JSON.stringify(item.options ?? {}), item.notes ?? null]);
  }

  const discountTotal = p.discount_total ?? String(order.discount_total ?? '0');
  const given = await client.query<{ subtotal: string; net_subtotal: string; discount: string; cap: string | null }>(
    `SELECT (coalesce(sum(i.line_total), 0) + coalesce(sum(i.discount), 0))::text AS subtotal,
            coalesce(sum(i.line_total), 0)::text                                 AS net_subtotal,
            (coalesce(sum(i.discount), 0) + round($3::numeric, 2))::text          AS discount,
            (SELECT max_discount_percent::text FROM branches WHERE id = $2)       AS cap
       FROM order_items i WHERE i.order_id = $1 AND i.deleted_at IS NULL`,
    [entityId, auth.branchId, discountTotal]);
  const { subtotal: beforeDiscount, net_subtotal: netSubtotal, discount: givenDiscount, cap } = given.rows[0]!;
  if (!hasPermission(auth.role.permissions, 'orders:discount:override') &&
      discountExceedsCap(beforeDiscount, givenDiscount, cap === null ? null : Number(cap))) {
    throw new MutationRejected('discount_too_large', `this shop allows at most ${cap}% without a manager`);
  }
  // Checked here, before the write, so the person sees a clear reason instead of a raw database error: the total
  // column itself also enforces total >= 0, but that message is meant for a bug, not for someone typing a number.
  if (Number(netSubtotal) - Number(discountTotal) + Number(order.delivery_fee ?? 0) < 0) {
    throw new MutationRejected('invalid_payload', 'the discount cannot exceed the new subtotal plus delivery');
  }

  const totals = await client.query<DbRow>(
    `UPDATE orders o
        SET subtotal = s.subtotal, discount_total = round($3::numeric, 2), tax_total = s.tax,
            total = s.subtotal - round($3::numeric, 2) + o.delivery_fee + s.tax
       FROM (
         SELECT coalesce(sum(line_total), 0) AS subtotal,
                branch_vat_amount($2, coalesce(sum(line_total), 0) - round($3::numeric, 2) + round($4::numeric, 2)) AS tax
           FROM order_items WHERE order_id = $1 AND deleted_at IS NULL
       ) s
      WHERE o.id = $1 AND o.branch_id = $2
      RETURNING o.*`,
    [entityId, auth.branchId, discountTotal, String(order.delivery_fee ?? '0')]);

  // Raising an order's total is the same exposure as placing a new one of that size: the credit limit applies to both.
  await assertWithinCreditLimit(ctx, String(order.customer_id), entityId, Number(totals.rows[0]!.total));

  if (inProduction || hasPayment || hasInvoice) {
    await logAudit(client, auth, 'order.items_edited_after_lock', { type: 'order', id: entityId },
      { reason: p.override_reason!.trim(), in_production: inProduction, had_payment: hasPayment, had_invoice: hasInvoice });
  }

  return { row: totals.rows[0] };
};
