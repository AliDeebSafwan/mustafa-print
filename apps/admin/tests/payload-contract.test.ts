import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { MUTATION_PAYLOADS, uuidv7 } from '@mpe/shared'
import { changeOrderStatus, createOrderLocally } from '../src/offline/actions'
import { db } from '../src/offline/db'

/**
 * Everything the app queues must be accepted by the schemas the SERVER validates with.
 * If the app and the API ever drift apart, this fails here instead of in the shop.
 */
beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

const acceptedByServer = (kind: keyof typeof MUTATION_PAYLOADS, payload: unknown) => {
  const parsed = MUTATION_PAYLOADS[kind].safeParse(payload)
  expect(parsed.error?.issues ?? []).toEqual([])
  return parsed.data
}

describe('offline payloads match the server contract', () => {
  it('a new order, with exact decimal strings for money', async () => {
    await createOrderLocally({ customerId: uuidv7(), currency: 'USD', items: [{ name: 'Flyers', quantity: '3', unitPrice: '10.10' }, { name: 'Cards', quantity: 1, unitPrice: 25 }] })
    const [m] = await db.outbox.orderBy('clientCreatedAt').toArray()
    const parsed = acceptedByServer('orders:insert', m!.payload) as { items: { quantity: string; unit_price: string }[] }
    expect(parsed.items.map((i) => [i.quantity, i.unit_price])).toEqual([['3', '10.10'], ['1', '25']])
    expect(m!.payload).not.toHaveProperty('total')               // totals are the server's job
  })

  it('a status change, from a manual tap and from a scan', async () => {
    const order = await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] })
    await changeOrderStatus(order, 'printing', { source: 'scanner', barcode: order.public_code })
    const mutations = (await db.outbox.orderBy('clientCreatedAt').toArray()).filter((m) => m.entity === 'order_status_history')
    expect(mutations).toHaveLength(1)
    acceptedByServer('order_status_history:status_change', mutations[0]!.payload)
  })
})
