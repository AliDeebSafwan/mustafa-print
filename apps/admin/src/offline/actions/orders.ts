import { canTransition, computeOrderTotals, generatePublicCode, isOrderStatus, uuidv7, type DecimalInput, type OrderStatus, type TotalsError } from '@mpe/shared'
import { db, type OrderItemRow, type OrderRow } from '../db'
import { buildPatch } from '../patch'
import { newMutation } from './mutation'

export class InvalidTransitionError extends Error {
  readonly from: string
  readonly to: string
  constructor(from: string, to: string) {
    super(`Cannot move an order from "${from}" to "${to}"`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

/** The amounts do not add up (a line discounted below zero, a value that is not a number...). */
export class InvalidOrderError extends Error {
  readonly reason: TotalsError
  readonly line?: number
  constructor(reason: TotalsError, line?: number) { super(`Invalid order: ${reason}${line === undefined ? '' : ` (line ${line + 1})`}`); this.name = 'InvalidOrderError'; this.reason = reason; this.line = line }
}

/** Move an order to a new status while offline (scanner or manual). The server re-validates on sync. */
export async function changeOrderStatus(order: OrderRow, to: OrderStatus, opts: { source: 'scanner' | 'manual'; barcode?: string; note?: string }): Promise<void> {
  if (!isOrderStatus(order.status) || !canTransition(order.status, to)) throw new InvalidTransitionError(order.status, to)
  const note = opts.note?.trim() || null
  const mutation = newMutation('order_status_history:status_change', uuidv7(), {
    order_id: order.id, from_status: order.status, to_status: to, source: opts.source, barcode_code: opts.barcode ?? null, note, occurred_at: new Date().toISOString(),
  }, order.row_version ?? null)
  await db.transaction('rw', db.orders, db.outbox, async () => {
    // The server records the reason on the order when the new status is "cancelled"; mirror that locally.
    await db.orders.update(order.id, { status: to, _pending: true, ...(to === 'cancelled' ? { cancel_reason: note } : {}) })
    await db.outbox.add(mutation)
  })
}

/** Cancelling always carries a reason: it is what the shop reads months later when asked why. */
export const cancelOrder = (order: OrderRow, reason: string): Promise<void> =>
  changeOrderStatus(order, 'cancelled', { source: 'manual', note: reason })

/**
 * Fields of an order a person may correct after it was taken. Prices and items are NOT here: changing what was
 * charged needs the server to recompute the totals, and that is a separate job (see ROADMAP 1.13).
 */
export const EDITABLE_ORDER_FIELDS = [
  'customer_notes', 'internal_notes', 'delivery_address', 'delivery_city', 'delivery_notes', 'due_at', 'fulfillment_type', 'payment_method',
] as const

export async function editOrder(order: OrderRow, next: Record<string, unknown>): Promise<boolean> {
  const patch = buildPatch(order, next, EDITABLE_ORDER_FIELDS)
  if (!patch) return false
  const mutation = newMutation('orders:update', order.id, patch as never, order.row_version ?? null)
  await db.transaction('rw', db.orders, db.outbox, async () => {
    await db.orders.update(order.id, { ...patch.changes, _pending: true })
    await db.outbox.add(mutation)
  })
  return true
}

export interface NewOrderInput {
  customerId: string
  items: { name: string; quantity: DecimalInput; unitPrice: DecimalInput; discount?: DecimalInput; productId?: string }[]
  currency?: string
  fulfillmentType?: 'pickup' | 'delivery'
  deliveryAddress?: string
  deliveryCity?: string
  deliveryNotes?: string
  deliveryFee?: DecimalInput
  discountTotal?: DecimalInput
  paymentMethod?: 'cash' | 'cod' | 'whish_money'
  customerNotes?: string
  internalNotes?: string
  /** ISO timestamp */
  dueAt?: string
}

const text = (value: string | undefined) => (value?.trim() ? value.trim() : undefined)

/**
 * Create an order on the device. Ids and the tracking/barcode code are minted here; the server assigns the order number
 * and recomputes the real totals (with the same arithmetic, so the two agree).
 */
export async function createOrderLocally(input: NewOrderInput): Promise<OrderRow> {
  const totals = computeOrderTotals({
    lines: input.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount })),
    discountTotal: input.discountTotal, deliveryFee: input.deliveryFee,
  })
  if (!totals.ok) throw new InvalidOrderError(totals.error, totals.line)

  const id = uuidv7()
  const now = new Date().toISOString()
  const delivery = input.fulfillmentType === 'delivery'
  const items: OrderItemRow[] = input.items.map((item, index) => ({
    id: uuidv7(), order_id: id, sort_order: index, name_snapshot: item.name.trim(), quantity: String(item.quantity).trim(),
    unit_price: String(item.unitPrice).trim(), line_total: totals.lines[index]!, product_id: item.productId ?? null,
  }))
  const order: OrderRow = {
    id, public_code: generatePublicCode(), order_number: null, status: 'received', customer_id: input.customerId,
    subtotal: totals.subtotal, discount_total: totals.discountTotal, delivery_fee: totals.deliveryFee, total: totals.total,
    paid_total: '0.00', payment_status: 'unpaid', currency: input.currency ?? 'USD', placed_at: now, _pending: true,
    fulfillment_type: delivery ? 'delivery' : 'pickup', payment_method: input.paymentMethod ?? 'cod',
    delivery_address: delivery ? text(input.deliveryAddress) ?? null : null, delivery_city: delivery ? text(input.deliveryCity) ?? null : null,
    delivery_notes: delivery ? text(input.deliveryNotes) ?? null : null, customer_notes: text(input.customerNotes) ?? null,
    internal_notes: text(input.internalNotes) ?? null, due_at: input.dueAt ?? null,
  }
  const mutation = newMutation('orders:insert', id, {
    public_code: order.public_code, customer_id: input.customerId, ...(input.currency ? { currency: input.currency } : {}),
    fulfillment_type: order.fulfillment_type as 'pickup' | 'delivery', payment_method: order.payment_method as 'cash' | 'cod' | 'whish_money',
    discount_total: totals.discountTotal, delivery_fee: totals.deliveryFee,
    ...(order.delivery_address ? { delivery_address: order.delivery_address } : {}),
    ...(order.delivery_city ? { delivery_city: order.delivery_city } : {}),
    ...(order.delivery_notes ? { delivery_notes: order.delivery_notes } : {}),
    ...(order.customer_notes ? { customer_notes: order.customer_notes } : {}),
    ...(order.internal_notes ? { internal_notes: order.internal_notes } : {}),
    ...(input.dueAt ? { due_at: input.dueAt } : {}),
    items: items.map((item, index) => ({
      id: item.id, name_snapshot: item.name_snapshot, quantity: item.quantity, unit_price: item.unit_price, sort_order: index,
      ...(input.items[index]!.discount !== undefined ? { discount: input.items[index]!.discount } : {}),
      ...(item.product_id ? { product_id: item.product_id as string } : {}),
    })),
  })
  await db.transaction('rw', db.orders, db.order_items, db.outbox, async () => {
    await db.orders.add(order)
    await db.order_items.bulkAdd(items)
    await db.outbox.add(mutation)
  })
  return order
}

/** Extract a tracking code from a scanned QR (full tracking URL) or a typed code. */
export function parseScannedCode(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/([0-9A-HJKMNP-TV-Z]{10,16})\/?(?:[?#].*)?$/)
  return m?.[1] ?? null
}

export async function findOrderByCode(raw: string): Promise<OrderRow | undefined> {
  const code = parseScannedCode(raw)
  return code ? db.orders.where('public_code').equals(code).first() : undefined
}

// ---- 1.13: editing an order's items after creation ----------------------------------------------------------------

const IN_PRODUCTION = new Set(['printing', 'finishing', 'ready', 'out_for_delivery'])

/** Whether this order currently needs a reason (and the orders:items:override permission) to edit its items. */
export function itemsEditIsLocked(order: OrderRow): boolean {
  return IN_PRODUCTION.has(order.status) || Number(order.paid_total ?? 0) > 0 || Boolean(order.invoice_number)
}

export interface EditItemsInput {
  items: { name: string; quantity: DecimalInput; unitPrice: DecimalInput; discount?: DecimalInput; productId?: string; notes?: string }[]
  discountTotal?: DecimalInput
  /** Required when itemsEditIsLocked(order) is true; ignored otherwise. */
  overrideReason?: string
}

/**
 * Replaces an order's whole item list — the fix for a wrong quantity or price that today means cancelling the
 * order and starting over. The device previews the new subtotal and discount locally (tax is not, since the
 * shop's VAT rate is applied by the server); the server recomputes the real totals once this reaches it, and a
 * locked order's edit is refused there too if the reason or permission is missing.
 */
export async function editOrderItemsLocally(order: OrderRow, input: EditItemsInput): Promise<void> {
  const totals = computeOrderTotals({
    lines: input.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount })),
    discountTotal: input.discountTotal ?? order.discount_total, deliveryFee: order.delivery_fee,
  })
  if (!totals.ok) throw new InvalidOrderError(totals.error, totals.line)

  const items: OrderItemRow[] = input.items.map((item, index) => ({
    id: uuidv7(), order_id: order.id, sort_order: index, name_snapshot: item.name.trim(), quantity: String(item.quantity).trim(),
    unit_price: String(item.unitPrice).trim(), line_total: totals.lines[index]!, product_id: item.productId ?? null, notes: item.notes?.trim() || null,
  }))
  const mutation = newMutation('orders:edit_items', order.id, {
    items: items.map((item, index) => ({
      id: item.id, name_snapshot: item.name_snapshot, quantity: item.quantity, unit_price: item.unit_price, sort_order: index,
      ...(input.items[index]!.discount !== undefined ? { discount: input.items[index]!.discount } : {}),
      ...(item.product_id ? { product_id: item.product_id as string } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    })),
    ...(input.discountTotal !== undefined ? { discount_total: totals.discountTotal } : {}),
    ...(input.overrideReason?.trim() ? { override_reason: input.overrideReason.trim() } : {}),
  })
  await db.transaction('rw', db.orders, db.order_items, db.outbox, async () => {
    await db.order_items.where('order_id').equals(order.id).delete()
    await db.order_items.bulkAdd(items)
    await db.orders.update(order.id, { subtotal: totals.subtotal, discount_total: totals.discountTotal, total: totals.total, _pending: true })
    await db.outbox.add(mutation)
  })
}
