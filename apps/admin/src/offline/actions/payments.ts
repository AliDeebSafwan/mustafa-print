import { formatCents, summarizePayments, toCents, uuidv7 } from '@mpe/shared'
import { db, type TransactionRow } from '../db'
import { newMutation } from './mutation'

export type PaymentErrorCode = 'order_missing' | 'invalid_amount' | 'order_cancelled' | 'refund_exceeds_paid'
export class PaymentError extends Error {
  readonly code: PaymentErrorCode
  constructor(code: PaymentErrorCode) { super(code); this.name = 'PaymentError'; this.code = code }
}

export interface NewPaymentInput {
  orderId: string
  type: 'payment' | 'refund'
  method: 'cash' | 'cod'
  /** Decimal text such as "25" or "12.50" */
  amount: string
  note?: string
}

/**
 * Re-derives the order's paid_total / payment_status from its payments on THIS device, the same way the database does.
 * Rejected payments are left out, so a payment the server refused stops counting.
 */
export async function recomputeOrderPayment(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) return
  const payments = await db.transactions.where('order_id').equals(orderId).filter((t) => t.status === 'completed' && !t._rejected && !t.deleted_at).toArray()
  const summary = summarizePayments(order.total, payments)
  await db.orders.update(orderId, { paid_total: summary.net, payment_status: summary.status })
}

/** Record cash taken at the counter, cash collected on delivery, or a refund. Works offline. */
export async function recordPaymentLocally(input: NewPaymentInput): Promise<TransactionRow> {
  const order = await db.orders.get(input.orderId)
  if (!order) throw new PaymentError('order_missing')
  const cents = toCents(input.amount)
  if (cents === null || cents <= 0) throw new PaymentError('invalid_amount')
  if (input.type === 'payment' && order.status === 'cancelled') throw new PaymentError('order_cancelled')
  if (input.type === 'refund' && cents > (toCents(order.paid_total ?? '0') ?? 0)) throw new PaymentError('refund_exceeds_paid')

  const id = uuidv7()
  const amount = formatCents(cents)
  const collectedAt = new Date().toISOString()
  const row: TransactionRow = {
    id, order_id: order.id, customer_id: order.customer_id, txn_type: input.type, method: input.method, status: 'completed',
    amount, currency: order.currency, collected_at: collectedAt, note: input.note?.trim() || null, _pending: true,
  }
  const mutation = newMutation('transactions:insert', id, {
    order_id: order.id, txn_type: input.type, method: input.method, amount, collected_at: collectedAt,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  })
  await db.transaction('rw', db.orders, db.transactions, db.outbox, async () => {
    await db.transactions.add(row)
    await db.outbox.add(mutation)
    await recomputeOrderPayment(order.id)
  })
  return row
}
