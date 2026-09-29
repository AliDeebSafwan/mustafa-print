// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'receptionist', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { EditCustomerPage } from '../../src/pages/customers/EditCustomerPage'
import { EditOrderPage } from '../../src/pages/orders/EditOrderPage'
import { OrderDetailPage } from '../../src/pages/orders/OrderDetailPage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'receptionist' })

async function seed() {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: false })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Banner', quantity: 1, unitPrice: 50 }] })
  await db.outbox.clear()
  await db.customers.update(customer.id, { _pending: false })
  await db.orders.update(order.id, { _pending: false })
  return { customer, order }
}
const editCustomer = (id: string) => renderAt(`/customers/${id}/edit`, [{ path: '/customers/:id/edit', element: <EditCustomerPage /> }])
const editOrder = (id: string) => renderAt(`/orders/${id}/edit`, [{ path: '/orders/:id/edit', element: <EditOrderPage /> }])
const detail = (id: string) => renderAt(`/orders/${id}`, [{ path: '/orders/:id', element: <OrderDetailPage /> }])

describe('editing a customer', () => {
  it('corrects a mistyped phone number and normalises what was typed', async () => {
    const { customer } = await seed()
    const user = userEvent.setup()
    editCustomer(customer.id)
    const phone = await screen.findByLabelText('Phone number')
    expect((phone as HTMLInputElement).value).toBe('+96170123456')
    await user.clear(phone)
    await user.type(phone, '03 999 888')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(async () => expect((await db.customers.get(customer.id))!.phone_e164).toBe('+9613999888'))
    const [m] = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(m!.payload).toEqual({ changes: { phone_e164: '+9613999888' }, base: { phone_e164: '+96170123456' } })
  })

  it('refuses a phone that cannot be real and saves nothing', async () => {
    const { customer } = await seed()
    const user = userEvent.setup()
    editCustomer(customer.id)
    const phone = await screen.findByLabelText('Phone number')
    await user.clear(phone)
    await user.type(phone, '12')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That phone number is not valid')
    expect(await db.outbox.count()).toBe(0)
  })

  it('will not leave a customer with no way to reach them', async () => {
    const { customer } = await seed()
    const user = userEvent.setup()
    editCustomer(customer.id)
    await user.clear(await screen.findByLabelText('Phone number'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a phone number or an email')
  })

  it('records where consent came from when messaging is switched on', async () => {
    const { customer } = await seed()
    const user = userEvent.setup()
    editCustomer(customer.id)
    await user.click(await screen.findByRole('checkbox', { name: /WhatsApp/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(1))
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toMatchObject({ changes: { whatsapp_opt_in: true, consent_source: 'in_person' } })
  })

  it('marking a customer a company reveals its fields, and only sends what changed', async () => {
    const { customer } = await seed()
    const user = userEvent.setup()
    editCustomer(customer.id)
    expect(screen.queryByLabelText('Company name')).toBeNull()
    await user.click(await screen.findByRole('checkbox', { name: 'This customer is a company (B2B)' }))
    await user.type(screen.getByLabelText('Company name'), 'Haddad Print Supplies')
    await user.type(screen.getByLabelText('Tax number'), 'LB-1234567')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(1))
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toMatchObject({
      changes: { customer_type: 'b2b', company_name: 'Haddad Print Supplies', tax_number: 'LB-1234567' },
    })
  })

  it('hides the credit limit field from a role without customers:credit:manage, but shows the current value', async () => {
    const { customer } = await seed()
    await db.customers.update(customer.id, { customer_type: 'b2b', company_name: 'Test Co', credit_limit: '300.00' })
    editCustomer(customer.id)
    await screen.findByText('Company account')
    expect(screen.queryByLabelText(/^Credit limit/)).toBeNull()
    expect(await screen.findByText('Current credit limit: 300.00. Changing it needs a manager\'s permission.')).toBeTruthy()
  })

  it('lets a manager set the credit limit', async () => {
    session.role = 'admin'
    const { customer } = await seed()
    await db.customers.update(customer.id, { customer_type: 'b2b', company_name: 'Test Co' })
    const user = userEvent.setup()
    editCustomer(customer.id)
    await user.type(await screen.findByLabelText(/^Credit limit/), '500')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(1))
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toMatchObject({ changes: { credit_limit: '500' } })
  })
})

describe('editing an order', () => {
  it('turns a pickup into a delivery, asking for the address first', async () => {
    const { order } = await seed()
    const user = userEvent.setup()
    editOrder(order.id)
    await user.click(await screen.findByRole('radio', { name: 'Delivery' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the delivery address')

    await user.type(screen.getByLabelText('Address'), 'Cedar street')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect((await db.orders.get(order.id))!.fulfillment_type).toBe('delivery'))
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toMatchObject({ changes: { fulfillment_type: 'delivery', delivery_address: 'Cedar street' } })
  })

  it('says plainly that items and prices are not edited here', async () => {
    const { order } = await seed()
    editOrder(order.id)
    expect(await screen.findByText('To change items or prices, create a new order and cancel this one.')).toBeTruthy()
  })

  it('refuses to open for a closed order', async () => {
    const { order } = await seed()
    await db.orders.update(order.id, { status: 'delivered' })
    editOrder(order.id)
    expect((await screen.findByRole('alert')).textContent).toBe('This order is closed and cannot be edited.')
  })
})

describe('cancelling from the order screen', () => {
  beforeEach(() => { session.role = 'admin' })

  it('asks for a reason, refuses an empty one, and records it', async () => {
    const { order } = await seed()
    const user = userEvent.setup()
    detail(order.id)
    await user.click(await screen.findByRole('button', { name: 'Cancel the order' }))
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Write why it is being cancelled')
    expect((await db.orders.get(order.id))!.status).toBe('received')

    await user.type(screen.getByLabelText('Reason for cancelling'), 'customer changed their mind')
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
    await vi.waitFor(async () => expect((await db.orders.get(order.id))!.status).toBe('cancelled'))
    expect((await db.orders.get(order.id))!.cancel_reason).toBe('customer changed their mind')
    expect(await screen.findByText(/Cancelled because/)).toBeTruthy()
  })

  it('backing out changes nothing', async () => {
    const { order } = await seed()
    const user = userEvent.setup()
    detail(order.id)
    await user.click(await screen.findByRole('button', { name: 'Cancel the order' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(await screen.findByRole('button', { name: 'Cancel the order' })).toBeTruthy()
    expect((await db.orders.get(order.id))!.status).toBe('received')
    expect(await db.outbox.count()).toBe(0)
  })
})
