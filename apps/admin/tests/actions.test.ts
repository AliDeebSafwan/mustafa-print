import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from '@mpe/shared'
import {
  InvalidMutationError, InvalidOrderError, PaymentError, consentedChannels, createCustomerLocally, createOrderLocally, newMutation, nextTimestamp,
  recomputeOrderPayment, recordPaymentLocally, searchCustomers, sendManualMessageLocally,
} from '../src/offline/actions'
import { db, type OrderRow } from '../src/offline/db'

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

const customer = async (phone = '+96170123456', name = 'Rana Haddad') => (await createCustomerLocally({ fullName: name, phone, whatsappOptIn: true })).customer
const order = async (over: Partial<Parameters<typeof createOrderLocally>[0]> = {}): Promise<OrderRow> =>
  createOrderLocally({ customerId: (await customer()).id, items: [{ name: 'Flyers', quantity: '2', unitPrice: '25' }], ...over })

describe('mutation queue', () => {
  it('timestamps never repeat or go backwards, even within one millisecond', () => {
    const now = 1_800_000_000_000
    const stamps = Array.from({ length: 500 }, () => nextTimestamp(now))
    expect([...stamps].sort()).toEqual(stamps)
    expect(new Set(stamps).size).toBe(500)
  })

  it('a customer is always queued before the order that uses them', async () => {
    const c = await customer()
    await createOrderLocally({ customerId: c.id, items: [{ name: 'x', quantity: 1, unitPrice: 1 }] })
    const queued = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(queued.map((m) => m.entity)).toEqual(['customers', 'orders'])
  })

  it('refuses to queue something the server is certain to reject', () => {
    expect(() => newMutation('customers:insert', uuidv7(), { full_name: '', phone_e164: '123' })).toThrow(InvalidMutationError)
    expect(() => newMutation('transactions:insert', uuidv7(), { order_id: uuidv7(), txn_type: 'payment', method: 'cash', amount: '1.23456' })).toThrow(/amount/)
  })
})

describe('customers', () => {
  it('registers a customer and queues one mutation; consent is only recorded when given', async () => {
    const { customer: c, created } = await createCustomerLocally({ fullName: '  Omar  ', phone: '+96171999888', whatsappOptIn: false })
    expect(created).toBe(true)
    expect(c).toMatchObject({ full_name: 'Omar', phone_e164: '+96171999888', whatsapp_opt_in: false, _pending: true })
    const [m] = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(m!.payload).toMatchObject({ whatsapp_opt_in: false })
    expect(m!.payload).not.toHaveProperty('consent_source')
    const opted = await createCustomerLocally({ fullName: 'Nour', phone: '+96171000111', whatsappOptIn: true })
    expect((await db.outbox.get((await db.outbox.orderBy('clientCreatedAt').toArray()).at(-1)!.id))!.payload).toMatchObject({ whatsapp_opt_in: true, consent_source: 'in_person' })
    expect(opted.customer.id).not.toBe(c.id)
  })

  it('never registers the same phone twice on one device', async () => {
    const first = await createCustomerLocally({ fullName: 'A', phone: '+96170123456', whatsappOptIn: false })
    const again = await createCustomerLocally({ fullName: 'A (typed again)', phone: '+96170123456', whatsappOptIn: true })
    expect(again).toMatchObject({ created: false, customer: { id: first.customer.id } })
    expect(await db.outbox.count()).toBe(1)
    expect(await db.customers.count()).toBe(1)
  })

  it('searches by name or by any part of the phone, with Arabic digits, ignoring deleted customers', async () => {
    await customer('+96170123456', 'Rana Haddad')
    await customer('+96176555444', 'Omar Khoury')
    const gone = await customer('+96178000999', 'Rana Deleted')
    await db.customers.update(gone.id, { deleted_at: '2026-01-01T00:00:00Z' })
    expect((await searchCustomers('rana')).map((c) => c.full_name)).toEqual(['Rana Haddad'])
    expect((await searchCustomers('555')).map((c) => c.full_name)).toEqual(['Omar Khoury'])
    expect((await searchCustomers('٧٠١٢٣')).map((c) => c.full_name)).toEqual(['Rana Haddad'])
    expect(await searchCustomers('r')).toEqual([])
    expect(await searchCustomers('nobody')).toEqual([])
  })
})

describe('creating orders', () => {
  it('writes order, items and one mutation together, with the totals the server will compute', async () => {
    const o = await createOrderLocally({
      customerId: (await customer()).id, fulfillmentType: 'delivery', deliveryAddress: 'Main st', deliveryCity: 'Hermel', deliveryFee: '2.50', discountTotal: '1', paymentMethod: 'cash',
      items: [{ name: 'Flyers', quantity: '3', unitPrice: '10.10', discount: '0.30' }, { name: 'Stickers', quantity: 2, unitPrice: 4.5 }],
    })
    expect(o).toMatchObject({ order_number: null, status: 'received', subtotal: '39.00', total: '40.50', paid_total: '0.00', payment_status: 'unpaid', fulfillment_type: 'delivery', delivery_address: 'Main st', _pending: true })
    expect((await db.order_items.where('order_id').equals(o.id).sortBy('sort_order')).map((i) => i.line_total)).toEqual(['30.00', '9.00'])
    const m = (await db.outbox.orderBy('clientCreatedAt').toArray()).find((x) => x.entity === 'orders')!
    expect(m).toMatchObject({ op: 'insert', entityId: o.id })
    expect(m.payload).toMatchObject({ public_code: o.public_code, delivery_fee: '2.50', discount_total: '1.00', payment_method: 'cash', delivery_address: 'Main st' })
    expect(m.payload).not.toHaveProperty('total')
  })

  it('keeps delivery details out of a pickup order and refuses impossible amounts without writing anything', async () => {
    const c = await customer()
    const pickup = await createOrderLocally({ customerId: c.id, fulfillmentType: 'pickup', deliveryAddress: 'ignored', items: [{ name: 'x', quantity: 1, unitPrice: 1 }] })
    expect(pickup.delivery_address).toBeNull()
    const before = await db.outbox.count()
    await expect(createOrderLocally({ customerId: c.id, items: [{ name: 'x', quantity: 1, unitPrice: 5, discount: 9 }] })).rejects.toBeInstanceOf(InvalidOrderError)
    await expect(createOrderLocally({ customerId: c.id, items: [{ name: 'x', quantity: 1, unitPrice: 'abc' }] })).rejects.toMatchObject({ reason: 'invalid_amount' })
    expect(await db.outbox.count()).toBe(before)
    expect(await db.orders.count()).toBe(1)
  })
})

describe('payments', () => {
  it('records payments offline and keeps the order state as the database would', async () => {
    const o = await order()                                             // total 50.00
    expect(await recordPaymentLocally({ orderId: o.id, type: 'payment', method: 'cash', amount: '20' })).toMatchObject({ amount: '20.00', status: 'completed', _pending: true })
    expect(await db.orders.get(o.id)).toMatchObject({ paid_total: '20.00', payment_status: 'partial' })
    await recordPaymentLocally({ orderId: o.id, type: 'payment', method: 'cod', amount: '30.00', note: 'courier' })
    expect(await db.orders.get(o.id)).toMatchObject({ paid_total: '50.00', payment_status: 'paid' })
    await recordPaymentLocally({ orderId: o.id, type: 'refund', method: 'cash', amount: '50' })
    expect(await db.orders.get(o.id)).toMatchObject({ paid_total: '0.00', payment_status: 'refunded' })
    const queued = (await db.outbox.orderBy('clientCreatedAt').toArray()).filter((m) => m.entity === 'transactions')
    expect(queued).toHaveLength(3)
    expect(queued[1]!.payload).toMatchObject({ order_id: o.id, txn_type: 'payment', method: 'cod', amount: '30.00', note: 'courier' })
  })

  it('refuses what can never work, before anything is written', async () => {
    const o = await order()
    const attempt = (over: Partial<Parameters<typeof recordPaymentLocally>[0]>) => recordPaymentLocally({ orderId: o.id, type: 'payment', method: 'cash', amount: '10', ...over })
    await expect(attempt({ amount: '0' })).rejects.toMatchObject({ code: 'invalid_amount' })
    await expect(attempt({ amount: 'abc' })).rejects.toMatchObject({ code: 'invalid_amount' })
    await expect(attempt({ type: 'refund' })).rejects.toMatchObject({ code: 'refund_exceeds_paid' })
    await expect(attempt({ orderId: uuidv7() })).rejects.toMatchObject({ code: 'order_missing' })
    await db.orders.update(o.id, { status: 'cancelled' })
    await expect(attempt({})).rejects.toBeInstanceOf(PaymentError)
    expect((await db.outbox.orderBy('clientCreatedAt').toArray()).filter((m) => m.entity === 'transactions')).toHaveLength(0)
  })

  it('recomputing ignores payments the server refused', async () => {
    const o = await order()
    const p = await recordPaymentLocally({ orderId: o.id, type: 'payment', method: 'cash', amount: '20' })
    await db.transactions.update(p.id, { _rejected: 'forbidden' })
    await recomputeOrderPayment(o.id)
    expect(await db.orders.get(o.id)).toMatchObject({ paid_total: '0.00', payment_status: 'unpaid' })
  })
})

describe('manual messages', () => {
  it('lists only the channels the customer actually consented to, and never one missing a recipient', async () => {
    expect(consentedChannels({ whatsapp_opt_in: true, sms_opt_in: false, email_opt_in: false, phone_e164: '+96170123456', email: null })).toEqual(['whatsapp'])
    expect(consentedChannels({ whatsapp_opt_in: true, sms_opt_in: false, email_opt_in: false, phone_e164: null, email: null })).toEqual([])   // consented, but no phone on file
    expect(consentedChannels({ whatsapp_opt_in: true, sms_opt_in: true, email_opt_in: true, phone_e164: '+96170123456', email: 'x@example.com' })).toEqual(['whatsapp', 'sms', 'email'])
  })

  it('refuses a channel the customer never consented to, and queues nothing', async () => {
    const c = await customer()
    const o = await createOrderLocally({ customerId: c.id, items: [{ name: 'x', quantity: 1, unitPrice: 1 }] })
    await expect(sendManualMessageLocally({ orderId: o.id, channel: 'email', body: 'hello' })).rejects.toMatchObject({ code: 'not_consented' })
    expect(await db.notification_logs.where('order_id').equals(o.id).count()).toBe(0)
    expect((await db.outbox.toArray()).filter((m) => m.entity === 'notification_logs')).toHaveLength(0)
  })

  it('refuses an empty message before writing anything', async () => {
    const c = await customer()
    const o = await createOrderLocally({ customerId: c.id, items: [{ name: 'x', quantity: 1, unitPrice: 1 }] })
    await expect(sendManualMessageLocally({ orderId: o.id, channel: 'whatsapp', body: '   ' })).rejects.toMatchObject({ code: 'empty_message' })
    expect(await db.notification_logs.where('order_id').equals(o.id).count()).toBe(0)
  })

  it('queues a consented send, locally and in the outbox, in the same breath', async () => {
    const c = await customer()
    const o = await createOrderLocally({ customerId: c.id, items: [{ name: 'x', quantity: 1, unitPrice: 1 }] })
    const row = await sendManualMessageLocally({ orderId: o.id, channel: 'whatsapp', body: '  your order is ready  ' })
    expect(row).toMatchObject({ order_id: o.id, channel: 'whatsapp', trigger: 'manual', body: 'your order is ready', status: 'queued', recipient: '+96170123456' })
    const queued = (await db.outbox.toArray()).find((m) => m.entity === 'notification_logs')
    expect(queued).toMatchObject({ op: 'manual_send', payload: { order_id: o.id, channel: 'whatsapp', body: 'your order is ready' } })
  })
})
