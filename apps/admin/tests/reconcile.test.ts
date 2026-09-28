import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from '@mpe/shared'
import { changeOrderStatus, createCustomerLocally, createOrderLocally, recordPaymentLocally } from '../src/offline/actions'
import { db } from '../src/offline/db'
import { pushOutbox } from '../src/offline/sync'

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const deps = (fetchImpl: (sent: { mutations: { id: string }[] }) => unknown) => ({
  baseUrl: 'http://api.test', deviceId: 'device-12345678',
  fetchImpl: (async (_url: unknown, init?: RequestInit) => json(fetchImpl(JSON.parse(String(init?.body))))) as unknown as typeof fetch,
})
const SERVER_CUSTOMER = { id: uuidv7(), full_name: 'Rana (already registered)', phone_e164: '+96170123456', row_version: 3 }

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

describe('the same customer registered on two devices', () => {
  async function offlineDay() {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170123456', whatsappOptIn: true })
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Flyers', quantity: 2, unitPrice: 25 }] })
    await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cash', amount: '20' })
    return { customer, order }
  }
  /** The server keeps the first customer; everything that pointed at the duplicate fails as it would on the real server. */
  const serverVerdicts = (sent: { mutations: { id: string }[] }, ids: { customer: string; order: string; payment: string }) => ({
    results: sent.mutations.map((m) => {
      if (m.id === ids.customer) return { id: m.id, result: 'conflict', error: 'phone_already_registered', rowEntity: 'customers', row: SERVER_CUSTOMER }
      if (m.id === ids.order) return { id: m.id, result: 'rejected', error: 'reference_not_found: orders_customer_fk' }
      return { id: m.id, result: 'rejected', error: 'order_not_found' }
    }),
  })

  it('adopts the existing customer everywhere and sends the waiting order and payment again, under new ids', async () => {
    const { customer, order } = await offlineDay()
    const [mc, mo, mp] = await db.outbox.orderBy('clientCreatedAt').toArray()

    const out = await pushOutbox(deps((sent) => serverVerdicts(sent, { customer: mc!.id, order: mo!.id, payment: mp!.id })))
    expect(out).toMatchObject({ status: 'ok', conflicts: 0 })

    expect(await db.customers.get(customer.id)).toBeUndefined()
    expect(await db.customers.get(SERVER_CUSTOMER.id)).toMatchObject({ full_name: 'Rana (already registered)', _pending: false })
    expect((await db.orders.get(order.id))!.customer_id).toBe(SERVER_CUSTOMER.id)

    const queued = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(queued.map((m) => m.entity)).toEqual(['orders', 'transactions'])                    // customer done; order + payment retry, in order
    expect(queued.map((m) => m.id)).not.toContain(mo!.id)                                       // fresh ids: the server remembers the old verdicts
    expect(queued.map((m) => m.id)).not.toContain(mp!.id)
    expect(queued[0]!.payload.customer_id).toBe(SERVER_CUSTOMER.id)
    expect(queued[1]!.payload.order_id).toBe(order.id)
    expect(await db.conflicts.where('resolved').equals(0).count()).toBe(0)                      // nothing for a human to review
    expect(await db.conflicts.where('resolved').equals(1).count()).toBe(1)                      // but the merge is on record
  })

  it('does not retry forever: a second failure of the retried order is reported for review', async () => {
    await offlineDay()
    const [mc, mo, mp] = await db.outbox.orderBy('clientCreatedAt').toArray()
    await pushOutbox(deps((sent) => serverVerdicts(sent, { customer: mc!.id, order: mo!.id, payment: mp!.id })))
    const retried = await db.outbox.orderBy('clientCreatedAt').toArray()
    const out = await pushOutbox(deps((sent) => ({ results: sent.mutations.map((m) => ({ id: m.id, result: 'rejected', error: 'reference_not_found: something else' })) })))
    expect(out.conflicts).toBe(2)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.conflicts.where('resolved').equals(0).count()).toBe(2)
    expect(retried).toHaveLength(2)
  })
})

describe('changes the server refuses for good', () => {
  const reject = (error: string) => deps((sent) => ({ results: sent.mutations.map((m) => ({ id: m.id, result: 'rejected', error })) }))

  it('a refused payment stops counting toward what the customer owes', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'A', phone: '+96170123456', whatsappOptIn: false })
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'x', quantity: 1, unitPrice: 50 }] })
    const payment = await recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cash', amount: '20' })
    await db.outbox.filter((m) => m.entity !== 'transactions').delete()                             // only the payment goes out in this test
    expect(await db.orders.get(order.id)).toMatchObject({ paid_total: '20.00', payment_status: 'partial' })

    await pushOutbox(reject('forbidden: missing permission transactions:collect'))
    expect(await db.transactions.get(payment.id)).toMatchObject({ _rejected: expect.stringContaining('forbidden'), _pending: false })
    expect(await db.orders.get(order.id)).toMatchObject({ paid_total: '0.00', payment_status: 'unpaid' })
    expect(await db.conflicts.where('resolved').equals(0).count()).toBe(1)
  })

  it('a refused order is marked as such instead of looking saved', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'A', phone: '+96170123456', whatsappOptIn: false })
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'x', quantity: 1, unitPrice: 5 }] })
    await db.outbox.filter((m) => m.entity === 'customers').delete()
    await pushOutbox(reject('constraint_violation: order_items_line_total_check'))
    expect(await db.orders.get(order.id)).toMatchObject({ _pending: false, _rejected: expect.stringContaining('constraint_violation') })
  })

  it('a refused status change goes back to the previous status', async () => {
    const order = await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'x', quantity: 1, unitPrice: 5 }] })
    await db.outbox.clear()
    await changeOrderStatus(order, 'printing', { source: 'manual' })
    expect((await db.orders.get(order.id))!.status).toBe('printing')
    await pushOutbox(reject('forbidden: role receptionist may not set status printing'))
    expect(await db.orders.get(order.id)).toMatchObject({ status: 'received', _pending: false })
  })
})
