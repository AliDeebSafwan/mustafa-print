import { uuidv7, type MutationResult } from '@mpe/shared'
import { db, type OutboxItem } from './db'
import { recomputeOrderPayment } from './actions'

/**
 * What the device does with the server's verdicts beyond "server row wins". Runs inside the push transaction.
 *
 * Two situations are common in a shop with a flaky connection and must not silently lose work:
 *  1. Two devices register the same customer (same phone) while offline. The server keeps the first; the second device
 *     adopts that customer everywhere, and orders that were waiting on the duplicate are sent again under the right id.
 *  2. The server permanently refuses something (no permission, bad reference...). The optimistic copy on the device must
 *     stop pretending it worked.
 */
type Sent = Map<string, OutboxItem>

const DUPLICATE_CUSTOMER = 'phone_already_registered'

/** Customer inserts the server answered with "this phone already belongs to customer X". Maps local id -> server id. */
export async function adoptDuplicateCustomers(results: MutationResult[], sent: Sent): Promise<Map<string, string>> {
  const merges = new Map<string, string>()
  for (const result of results) {
    const mutation = sent.get(result.id)
    const serverId = result.row?.id
    if (mutation?.entity !== 'customers' || mutation.op !== 'insert' || result.error !== DUPLICATE_CUSTOMER || typeof serverId !== 'string') continue

    merges.set(mutation.entityId, serverId)
    await db.customers.put({ ...(result.row as { id: string; full_name: string; phone_e164: string | null }), _pending: false })
    await db.customers.delete(mutation.entityId)
    await db.orders.filter((o) => o.customer_id === mutation.entityId).modify({ customer_id: serverId })
    for (const queued of await db.outbox.toArray()) {
      if (queued.payload.customer_id === mutation.entityId) await db.outbox.update(queued.id, { payload: { ...queued.payload, customer_id: serverId } })
    }
  }
  return merges
}

export const isMergedDuplicate = (mutation: OutboxItem, merges: Map<string, string>): boolean => merges.has(mutation.entityId) && mutation.entity === 'customers'

/**
 * Mutations that failed only because they pointed at a duplicate customer (or at an order that failed for that reason)
 * are sent again with a NEW mutation id (the server remembers the old id's verdict) and the corrected payload.
 * `requeued` accumulates order ids so payments and status changes queued behind them follow.
 */
export async function requeueIfDependedOnMerge(mutation: OutboxItem, result: MutationResult, merges: Map<string, string>, requeued: Set<string>): Promise<boolean> {
  if (result.result !== 'rejected') return false
  const customerId = mutation.payload.customer_id
  const orderId = mutation.payload.order_id
  const dependsOnMerge =
    (result.error?.startsWith('reference_not_found') && typeof customerId === 'string' && merges.has(customerId)) ||
    (result.error === 'order_not_found' && typeof orderId === 'string' && requeued.has(orderId))
  if (!dependsOnMerge) return false

  const current = await db.outbox.get(mutation.id)            // its payload was already corrected in place
  if (!current) return false
  await db.outbox.delete(mutation.id)
  await db.outbox.add({ ...current, id: uuidv7(), attempts: 0, lastError: undefined })
  if (mutation.entity === 'orders') requeued.add(mutation.entityId)
  return true
}

/** The server refused this change for good: stop showing the optimistic copy as if it had worked. */
export async function markRejected(mutation: OutboxItem, reason: string): Promise<void> {
  const { entity, op, entityId, payload } = mutation
  if (op === 'insert' && entity === 'orders') await db.orders.update(entityId, { _pending: false, _rejected: reason })
  else if (op === 'insert' && entity === 'customers') await db.customers.update(entityId, { _pending: false, _rejected: reason })
  else if (op === 'insert' && entity === 'transactions') {
    await db.transactions.update(entityId, { _pending: false, _rejected: reason })
    if (typeof payload.order_id === 'string') await recomputeOrderPayment(payload.order_id)      // the refused payment stops counting
  } else if (op === 'status_change' && typeof payload.order_id === 'string') {
    const order = await db.orders.get(payload.order_id)
    // undo the optimistic move, unless something newer already replaced it
    if (order && order.status === payload.to_status && typeof payload.from_status === 'string') await db.orders.update(order.id, { status: payload.from_status, _pending: false })
  }
}
