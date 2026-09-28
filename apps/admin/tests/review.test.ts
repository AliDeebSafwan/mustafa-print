import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from '@mpe/shared'
import { createCustomerLocally, createOrderLocally, newMutation, recordPaymentLocally } from '../src/offline/actions'
import { db, type ConflictItem, type OutboxItem } from '../src/offline/db'
import { actionsFor, dismissConflict, discardConflict, isOrphanedInsert, retryConflict, unresolvedConflicts, unresolvedCount } from '../src/offline/review'

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

const failed = async (mutation: OutboxItem, over: Partial<ConflictItem> = {}): Promise<ConflictItem> => {
  const entry: ConflictItem = { id: mutation.id, mutation, result: 'rejected', error: 'forbidden', createdAt: new Date().toISOString(), resolved: 0, ...over }
  await db.conflicts.put(entry)
  return entry
}

describe('the review queue', () => {
  it('lists only what still needs a decision, newest first', async () => {
    const a = await failed(newMutation('customers:insert', uuidv7(), { full_name: 'A', phone_e164: '+96170111222' }))
    await db.conflicts.update(a.id, { createdAt: '2026-01-01T00:00:00Z' })
    await failed(newMutation('customers:insert', uuidv7(), { full_name: 'B', phone_e164: '+96170111333' }), { createdAt: '2026-02-01T00:00:00Z' })
    await failed(newMutation('customers:insert', uuidv7(), { full_name: 'C', phone_e164: '+96170111444' }), { resolved: 1 })

    expect((await unresolvedConflicts()).map((e) => (e.mutation.payload as { full_name: string }).full_name)).toEqual(['B', 'A'])
    expect(await unresolvedCount()).toBe(2)
  })

  it('offers deleting the local copy only for something the server never created', async () => {
    const insert = await failed(newMutation('orders:insert', uuidv7(), { public_code: 'K7M2Q9X4TB3D', customer_id: uuidv7(), items: [{ id: uuidv7(), name_snapshot: 'x', quantity: 1, unit_price: 1 }] }))
    const edit = await failed(newMutation('customers:update', uuidv7(), { changes: { notes: 'x' }, base: { notes: null } }), { result: 'conflict' })
    expect(isOrphanedInsert(insert)).toBe(true)
    expect(actionsFor(insert)).toEqual(['retry', 'discard', 'dismiss'])
    expect(actionsFor(edit)).toEqual(['retry', 'dismiss'])
  })
})

describe('retrying', () => {
  it('sends the work again under a new id, because the server remembers the old verdict', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170123456', whatsappOptIn: false })
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'x', quantity: 1, unitPrice: 5 }] })
    const txn = await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cash', amount: '5' })
    const mutation = (await db.outbox.orderBy('clientCreatedAt').toArray()).find((m) => m.entity === 'transactions')!
    await db.outbox.clear()
    const entry = await failed(mutation)

    expect(await retryConflict(entry.id)).toBe(true)
    const [queued] = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(queued!.id).not.toBe(mutation.id)
    expect(queued!.entityId).toBe(txn.id)
    expect(queued!.payload).toEqual(mutation.payload)
    expect(await unresolvedCount()).toBe(0)
    expect(await retryConflict(entry.id)).toBe(false)                 // a decision is taken once
  })

  it('rebases an edit on the server values, so "keep my change" does not conflict forever', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170123456', whatsappOptIn: false })
    await db.customers.update(customer.id, { notes: 'theirs', city: 'Beirut' })          // the server's version won at push time
    await db.outbox.clear()                                                              // the customer insert already went out
    const mutation = newMutation('customers:update', customer.id, { changes: { notes: 'mine' }, base: { notes: 'what I started from' } })
    const entry = await failed(mutation, { result: 'conflict', error: 'changed on the server meanwhile: notes', serverRow: { id: customer.id, notes: 'theirs', city: 'Beirut' } })

    await retryConflict(entry.id)
    const [queued] = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(queued!.payload).toEqual({ changes: { notes: 'mine' }, base: { notes: 'theirs' } })
    expect(await db.customers.get(customer.id)).toMatchObject({ notes: 'mine', city: 'Beirut', _pending: true })
  })

  it('does not invent a base for a field the server row does not have', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170123456', whatsappOptIn: false })
    await db.outbox.clear()
    const entry = await failed(newMutation('customers:update', customer.id, { changes: { city: 'Tyre' }, base: { city: null } }), { result: 'conflict', serverRow: { id: customer.id } })
    await retryConflict(entry.id)
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toEqual({ changes: { city: 'Tyre' }, base: { city: null } })
  })
})

describe('dismissing and discarding', () => {
  it('dismissing keeps the local copy and sends nothing', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170123456', whatsappOptIn: false })
    await db.outbox.clear()
    const entry = await failed(newMutation('customers:insert', customer.id, { full_name: 'Rana', phone_e164: '+96170123456' }))
    await dismissConflict(entry.id)
    expect(await unresolvedCount()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.customers.get(customer.id)).toBeDefined()
  })

  it('discarding removes the refused order and its items, and nothing else', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170123456', whatsappOptIn: false })
    const kept = await createOrderLocally({ customerId: customer.id, items: [{ name: 'kept', quantity: 1, unitPrice: 5 }] })
    const doomed = await createOrderLocally({ customerId: customer.id, items: [{ name: 'doomed', quantity: 1, unitPrice: 5 }] })
    const mutation = (await db.outbox.orderBy('clientCreatedAt').toArray()).find((m) => m.entity === 'orders' && m.entityId === doomed.id)!
    await db.outbox.clear()
    const entry = await failed(mutation)

    expect(await discardConflict(entry.id)).toBe(true)
    expect(await db.orders.get(doomed.id)).toBeUndefined()
    expect(await db.order_items.where('order_id').equals(doomed.id).count()).toBe(0)
    expect(await db.orders.get(kept.id)).toBeDefined()
    expect(await db.order_items.where('order_id').equals(kept.id).count()).toBe(1)
    expect(await db.customers.get(customer.id)).toBeDefined()
    expect(await unresolvedCount()).toBe(0)
  })

  it('refuses to discard an edit or a conflict (there is nothing orphaned to remove)', async () => {
    const entry = await failed(newMutation('customers:update', uuidv7(), { changes: { notes: 'x' }, base: { notes: null } }), { result: 'conflict' })
    expect(await discardConflict(entry.id)).toBe(false)
    expect(await unresolvedCount()).toBe(1)
  })
})
