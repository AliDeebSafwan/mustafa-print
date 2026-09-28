import { toCents } from '@mpe/shared'
import { db, type OrderRow, type TransactionRow } from '../db'
import { newMutation } from './mutation'

export interface UnsettledCod { transaction: TransactionRow; order?: OrderRow }

/**
 * Every COD payment collected but not yet handed over to the shop — regardless of who collected it, since staff
 * accounts are not tracked by identity here. Oldest first, so the longest-outstanding cash is settled first.
 */
export async function unsettledCod(): Promise<UnsettledCod[]> {
  const transactions = (await db.transactions
    .filter((t) => t.method === 'cod' && t.txn_type === 'payment' && t.status === 'completed' && !t.settled_at && !t._rejected && !t.deleted_at)
    .toArray())
    .sort((a, b) => (a.collected_at ?? '').localeCompare(b.collected_at ?? ''))
  const orders = await db.orders.bulkGet(transactions.map((t) => t.order_id))
  return transactions.map((transaction, i) => ({ transaction, order: orders[i] ?? undefined }))
}

/**
 * Records the cash handed over, one mutation per collection, so a partial hand-over is exactly what gets recorded
 * and a repeat never double-counts. Returns how many were queued.
 */
export async function settleCod(transactions: TransactionRow[]): Promise<number> {
  const settledAt = new Date().toISOString()
  const pending = transactions.filter((t) => !t.settled_at)
  if (pending.length === 0) return 0
  await db.transaction('rw', db.transactions, db.outbox, async () => {
    for (const txn of pending) {
      await db.outbox.add(newMutation('transactions:settle', txn.id, { settled_at: settledAt }, txn.row_version ?? null))
      await db.transactions.update(txn.id, { settled_at: settledAt, _pending: true })
    }
  })
  return pending.length
}

export const totalUnsettledCents = (rows: UnsettledCod[]): number => rows.reduce((sum, r) => sum + (toCents(r.transaction.amount) ?? 0), 0)
