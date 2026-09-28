import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { InvalidMutationError, cancelOrder, changeOrderStatus, createCustomerLocally, createOrderLocally, editCustomer, editOrder } from '../src/offline/actions'
import { db, type CustomerRow, type OrderRow } from '../src/offline/db'
import { buildPatch } from '../src/offline/patch'

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

const aCustomer = async (): Promise<CustomerRow> => {
  const { customer } = await createCustomerLocally({ fullName: 'Rana Haddad', phone: '+96170123456', whatsappOptIn: false })
  await db.customers.update(customer.id, { city: 'Beirut', notes: 'first note', _pending: false })
  await db.outbox.clear()
  return (await db.customers.get(customer.id))!
}
const anOrder = async (over: Partial<Parameters<typeof createOrderLocally>[0]> = {}): Promise<OrderRow> => {
  const customer = await aCustomer()
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Flyers', quantity: 1, unitPrice: 25 }], ...over })
  await db.outbox.clear()
  return order
}
const queued = async () => (await db.outbox.orderBy('clientCreatedAt').toArray())[0]

describe('building a patch', () => {
  const row = { id: 'x', notes: 'first note', city: 'Beirut', due_at: null, whatsapp_opt_in: false }

  it('sends only what changed, with the value it started from', () => {
    expect(buildPatch(row, { notes: 'second note', city: 'Beirut' }, ['notes', 'city']))
      .toEqual({ changes: { notes: 'second note' }, base: { notes: 'first note' } })
  })

  it('treats an emptied box as "no value", not as an empty string', () => {
    expect(buildPatch(row, { notes: '   ' }, ['notes'])).toEqual({ changes: { notes: null }, base: { notes: 'first note' } })
    expect(buildPatch(row, { due_at: '' }, ['due_at'])).toBeNull()               // was already empty: nothing changed
  })

  it('says "nothing changed" instead of sending an empty edit', () => {
    expect(buildPatch(row, { notes: 'first note', city: '  Beirut  ' }, ['notes', 'city'])).toBeNull()
    expect(buildPatch(row, {}, ['notes'])).toBeNull()
  })

  it('an empty box over a column that was never set is not a change', () => {
    // Without this the form would send a wall of nulls on every save and cause conflicts out of nothing.
    expect(buildPatch(row, { email: '', address_line: '  ', notes: 'first note' }, ['email', 'address_line', 'notes'])).toBeNull()
    expect(buildPatch({ id: 'x', notes: null }, { notes: '' }, ['notes'])).toBeNull()
  })

  it('never sends a field the caller did not list, even if it differs', () => {
    expect(buildPatch(row, { notes: 'new', city: 'Tyre' }, ['notes'])).toEqual({ changes: { notes: 'new' }, base: { notes: 'first note' } })
  })

  it('handles booleans and values that are absent from the row', () => {
    expect(buildPatch(row, { whatsapp_opt_in: true }, ['whatsapp_opt_in'])).toEqual({ changes: { whatsapp_opt_in: true }, base: { whatsapp_opt_in: false } })
    expect(buildPatch(row, { email: 'a@b.co' }, ['email'])).toEqual({ changes: { email: 'a@b.co' }, base: { email: null } })
  })
})

describe('editing a customer', () => {
  it('queues only the changed fields and shows the change immediately', async () => {
    const customer = await aCustomer()
    expect(await editCustomer(customer, { full_name: 'Rana Haddad', city: 'Tyre', notes: 'first note' })).toBe(true)
    expect(await db.customers.get(customer.id)).toMatchObject({ city: 'Tyre', notes: 'first note', _pending: true })
    expect((await queued())!.payload).toEqual({ changes: { city: 'Tyre' }, base: { city: 'Beirut' } })
  })

  it('sends nothing at all when a form is opened and closed unchanged', async () => {
    const customer = await aCustomer()
    expect(await editCustomer(customer, { full_name: customer.full_name, city: 'Beirut', notes: 'first note' })).toBe(false)
    expect(await db.outbox.count()).toBe(0)
  })

  it('refuses locally what the server would refuse anyway', async () => {
    const customer = await aCustomer()
    await expect(editCustomer(customer, { phone_e164: 'not a phone' })).rejects.toBeInstanceOf(InvalidMutationError)
    await expect(editCustomer(customer, { full_name: '' })).rejects.toBeInstanceOf(InvalidMutationError)
    await expect(editCustomer(customer, { whatsapp_opt_in: true })).rejects.toThrow(/consent_source/)   // no opt-in without recording consent
    expect(await db.outbox.count()).toBe(0)
    expect(await db.customers.get(customer.id)).toMatchObject({ full_name: 'Rana Haddad', whatsapp_opt_in: false })
  })

  it('accepts an opt-in when the consent source comes with it', async () => {
    const customer = await aCustomer()
    expect(await editCustomer(customer, { whatsapp_opt_in: true, consent_source: 'in_person' })).toBe(true)
    expect((await queued())!.payload).toMatchObject({ changes: { whatsapp_opt_in: true, consent_source: 'in_person' } })
  })
})

describe('editing an order', () => {
  it('changes the details a shop actually corrects, and leaves the money alone', async () => {
    const order = await anOrder()
    expect(await editOrder(order, { fulfillment_type: 'delivery', delivery_address: 'Main street', internal_notes: 'rush' })).toBe(true)
    const payload = (await queued())!.payload as { changes: Record<string, unknown> }
    expect(payload.changes).toEqual({ fulfillment_type: 'delivery', delivery_address: 'Main street', internal_notes: 'rush' })
    expect(await db.orders.get(order.id)).toMatchObject({ fulfillment_type: 'delivery', delivery_address: 'Main street', total: '25.00' })
  })

  it('cannot touch prices, totals or status even if asked to', async () => {
    const order = await anOrder()
    expect(await editOrder(order, { total: '1.00', status: 'delivered', subtotal: '1.00' })).toBe(false)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.orders.get(order.id)).toMatchObject({ total: '25.00', status: 'received' })
  })
})

describe('cancelling', () => {
  it('records the reason on the order and in the queued change', async () => {
    const order = await anOrder()
    await cancelOrder(order, '  customer changed their mind  ')
    expect(await db.orders.get(order.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'customer changed their mind', _pending: true })
    expect((await queued())!.payload).toMatchObject({ to_status: 'cancelled', note: 'customer changed their mind', from_status: 'received' })
  })

  it('a status change that is not a cancellation carries no reason', async () => {
    const order = await anOrder()
    await changeOrderStatus(order, 'in_design', { source: 'manual' })
    expect((await db.orders.get(order.id))!.cancel_reason).toBeUndefined()
    expect((await queued())!.payload).toMatchObject({ note: null })
  })

  it('refuses an empty reason before anything is queued', async () => {
    const order = await anOrder()
    await expect(cancelOrder(order, '   ')).rejects.toBeInstanceOf(InvalidMutationError)
    expect(await db.outbox.count()).toBe(0)
    expect((await db.orders.get(order.id))!.status).toBe('received')
  })
})
