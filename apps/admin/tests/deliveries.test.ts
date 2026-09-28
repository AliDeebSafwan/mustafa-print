import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createCustomerLocally, createOrderLocally, recordPaymentLocally, settleCod, totalUnsettledCents, unsettledCod } from '../src/offline/actions'
import { db, type OrderRow } from '../src/offline/db'

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

const anOrder = async (): Promise<OrderRow> => {
  const { customer } = await createCustomerLocally({ fullName: 'Karim', phone: `+9617${Math.floor(1e6 + Math.random() * 9e6)}`, whatsappOptIn: false })
  return createOrderLocally({ customerId: customer.id, fulfillmentType: 'delivery', deliveryAddress: 'Main street', items: [{ name: 'Banner', quantity: 1, unitPrice: 60 }] })
}
const collect = async (amount: string) => recordPaymentLocally({ orderId: (await anOrder()).id, type: 'payment', method: 'cod', amount })

describe('unsettled COD cash', () => {
  it('counts every collection not yet settled, and nothing the server refused', async () => {
    await collect('25')
    await collect('15.50')
    const rejected = await collect('99')
    await db.transactions.update(rejected.id, { _rejected: 'forbidden' })
    const counter = await recordPaymentLocally({ orderId: (await anOrder()).id, type: 'payment', method: 'cash', amount: '30' })
    void counter   // cash at the counter is never COD, so it never appears here regardless of who collected it

    const rows = await unsettledCod()
    expect(rows).toHaveLength(2)
    expect(totalUnsettledCents(rows)).toBe(4050)
  })

  it('pairs each collection with the order it belongs to', async () => {
    const order = await anOrder()
    await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cod', amount: '25' })
    const [row] = await unsettledCod()
    expect(row!.order?.id).toBe(order.id)
  })

  it('ignores an already-settled collection', async () => {
    const txn = await collect('25')
    await db.transactions.update(txn.id, { settled_at: '2026-01-01T00:00:00Z' })
    expect(await unsettledCod()).toEqual([])
  })

  it('queues one hand-over per collection and stops counting them', async () => {
    await collect('25')
    await collect('15.50')
    const rows = await unsettledCod()
    await db.outbox.clear()

    expect(await settleCod(rows.map((r) => r.transaction))).toBe(2)
    const queued = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(queued.map((m) => m.op)).toEqual(['settle', 'settle'])
    expect(queued.map((m) => m.entityId).sort()).toEqual(rows.map((r) => r.transaction.id).sort())
    expect(await unsettledCod()).toEqual([])

    expect(await settleCod(await db.transactions.toArray())).toBe(0)   // nothing left to hand over
    expect(await db.outbox.count()).toBe(2)
  })

  it('settling one collection leaves the others untouched', async () => {
    const a = await collect('25')
    await collect('100')
    await settleCod([a])

    const remaining = await unsettledCod()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.transaction.amount).toBe('100.00')
  })

  it('is empty when nothing is owed', async () => {
    expect(await unsettledCod()).toEqual([])
  })
})
