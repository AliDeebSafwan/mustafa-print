import { uuidv7, type MutationKind } from '@mpe/shared'
import { DATA_TABLES, db, isDataTable, type ConflictItem, type OutboxItem } from './db'

/**
 * What a human can do about work the server refused. Each entry in `conflicts` is one mutation that came back as
 * `conflict` (someone changed the same thing first) or `rejected` (it can never work as it was sent).
 *
 * Three honest options, nothing more:
 *  - **retry**: send it again. For an edit, the device re-bases it on the server's current values, which means
 *    "keep my change, replace theirs" — otherwise the same conflict would repeat forever.
 *  - **dismiss**: accept what the server has and stop showing the entry.
 *  - **discard**: only for something the server never created; removes the leftover copy from this device.
 */
export type ReviewAction = 'retry' | 'dismiss' | 'discard'

export const unresolvedConflicts = (): Promise<ConflictItem[]> =>
  db.conflicts.where('resolved').equals(0).reverse().sortBy('createdAt')

export const unresolvedCount = (): Promise<number> => db.conflicts.where('resolved').equals(0).count()

/** An entry is about a row the server never created, so a copy may be left behind on this device. */
export const isOrphanedInsert = (entry: ConflictItem): boolean => entry.result === 'rejected' && entry.mutation.op === 'insert'

export const actionsFor = (entry: ConflictItem): ReviewAction[] =>
  isOrphanedInsert(entry) ? ['retry', 'discard', 'dismiss'] : ['retry', 'dismiss']

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

/**
 * Sends the mutation again under a NEW id, because the server remembers the verdict of the old one.
 * For an edit it rebases on the server's row and re-applies the change locally, so the screen shows what is queued.
 */
export async function retryConflict(entryId: string): Promise<boolean> {
  const entry = await db.conflicts.get(entryId)
  if (!entry || entry.resolved) return false

  const { mutation, serverRow } = entry
  let payload = mutation.payload
  if (mutation.op === 'update' && serverRow) {
    const changes = asRecord(payload.changes)
    payload = { changes, base: Object.fromEntries(Object.keys(changes).map((field) => [field, serverRow[field] ?? null])) }
  }
  const queued: OutboxItem = { ...mutation, id: uuidv7(), payload, clientCreatedAt: new Date().toISOString(), attempts: 0, lastError: undefined }

  // Every data table joins the transaction: which one is touched depends on the entry, and Dexie needs them up front.
  await db.transaction('rw', [db.conflicts, db.outbox, ...DATA_TABLES.map((t) => db[t])], async () => {
    await db.outbox.add(queued)
    if (mutation.op === 'update' && isDataTable(mutation.entity)) {
      await db.table(mutation.entity).update(mutation.entityId, { ...asRecord(payload.changes), _pending: true })
    }
    await db.conflicts.update(entryId, { resolved: 1 })
  })
  return true
}

/** Accepts the server's version and clears the entry. Nothing is sent. */
export const dismissConflict = (entryId: string): Promise<number> => db.conflicts.update(entryId, { resolved: 1 })

/** Removes the local leftovers of something the server never created (an order also takes its items with it). */
export async function discardConflict(entryId: string): Promise<boolean> {
  const entry = await db.conflicts.get(entryId)
  if (!entry || !isOrphanedInsert(entry)) return false
  const { entity, entityId } = entry.mutation

  await db.transaction('rw', db.conflicts, db.orders, db.order_items, db.customers, db.transactions, async () => {
    if (entity === 'orders') {
      await db.order_items.where('order_id').equals(entityId).delete()
      await db.orders.delete(entityId)
    } else if (isDataTable(entity)) {
      await db.table(entity).delete(entityId)
    }
    await db.conflicts.update(entryId, { resolved: 1 })
  })
  return true
}

/** The mutation kind, for looking up a human sentence describing what was attempted. */
export const kindOf = (entry: ConflictItem): MutationKind | string => `${entry.mutation.entity}:${entry.mutation.op}`
