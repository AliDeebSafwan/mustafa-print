// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'receptionist', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null, depositPercent: 0, depositThreshold: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { LabelPage } from '../../src/pages/orders/LabelPage'
import { OrderDetailPage } from '../../src/pages/orders/OrderDetailPage'
import { OrdersPage } from '../../src/pages/orders/OrdersPage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'receptionist'; session.depositPercent = 0; session.depositThreshold = null })

async function seed() {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Banner 2x1m', quantity: 1, unitPrice: 50 }] })
  return { customer, order }
}
const detail = (id: string) => renderAt(`/orders/${id}`, [{ path: '/orders/:id', element: <OrderDetailPage /> }])

describe('order screen', () => {
  it('shows the order, and only the status moves this role may make', async () => {
    const { order } = await seed()
    detail(order.id)
    expect(await screen.findByText('Karim Saad')).toBeTruthy()
    expect(screen.getByText('Banner 2x1m')).toBeTruthy()
    expect(screen.getByText('Not sent to the server yet')).toBeTruthy()
    const moves = screen.getAllByRole('button').map((b) => b.textContent)
    expect(moves).toContain('In design')
    expect(moves).not.toContain('Printing')          // production stages belong to the machine operator
    expect(moves).not.toContain('Cancelled')         // cancelling is never a one-tap status button
    expect(screen.queryByRole('button', { name: 'Cancel the order' })).toBeNull()   // and the receptionist may not cancel at all
  })

  it('records a payment offline, updates what is owed, and blocks a typo bigger than the balance', async () => {
    const { order } = await seed()
    const user = userEvent.setup()
    detail(order.id)
    const amount = await screen.findByLabelText(/^Amount/)
    expect((amount as HTMLInputElement).value).toBe('50.00')          // defaults to what is owed

    await user.clear(amount)
    await user.type(amount, '500')
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect((await screen.findByRole('alert')).textContent).toContain('more than the remaining balance')
    expect(await db.transactions.count()).toBe(0)

    await user.clear(amount)
    await user.type(amount, '20')
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByText('Recorded. It will be sent when you are online.')).toBeTruthy()
    expect(await db.orders.get(order.id)).toMatchObject({ paid_total: '20.00', payment_status: 'partial' })
    expect(await screen.findByText(/Partly paid/)).toBeTruthy()
    expect(screen.getByText('30.00 USD')).toBeTruthy()                 // remaining
    expect((await db.outbox.orderBy('clientCreatedAt').toArray()).filter((m) => m.entity === 'transactions')).toHaveLength(1)
  })

  it('moving the order writes the change locally and queues it', async () => {
    const { order } = await seed()
    const user = userEvent.setup()
    detail(order.id)
    await user.click(await screen.findByRole('button', { name: 'In design' }))
    await vi.waitFor(async () => expect((await db.orders.get(order.id))!.status).toBe('in_design'))
    expect((await db.outbox.orderBy('clientCreatedAt').toArray()).some((m) => m.entity === 'order_status_history')).toBe(true)
  })

  it('an admin may refund; the receptionist is not offered it', async () => {
    const { order } = await seed()
    await db.orders.update(order.id, { paid_total: '20.00', payment_status: 'partial' })
    const view = detail(order.id)
    await screen.findByText('Karim Saad')
    expect(screen.queryByRole('radio', { name: 'Refund' })).toBeNull()
    view.unmount()
    session.role = 'admin'
    detail(order.id)
    expect(await screen.findByRole('radio', { name: 'Refund' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel the order' })).toBeTruthy()   // cancelling asks for a reason, so it is not a plain status button
  })

  it('says so when the server refused the order, in words the shop understands', async () => {
    const { order } = await seed()
    await db.orders.update(order.id, { _pending: false, _rejected: 'constraint_violation: order_items_line_total_check' })
    detail(order.id)
    expect((await screen.findByRole('alert')).textContent).toBe('The server did not accept this order: amounts or data not accepted')
  })

  it('reports an order that is not on this device', async () => {
    detail('does-not-exist')
    expect(await screen.findByText('This order is not on this device.')).toBeTruthy()
  })
})

describe('order list', () => {
  it('finds orders by number, code, name or phone, and hides finished ones until asked', async () => {
    const a = await seed()
    const { customer: c2 } = await createCustomerLocally({ fullName: 'Nour Aziz', phone: '+96171999000', whatsappOptIn: false })
    const b = await createOrderLocally({ customerId: c2.id, items: [{ name: 'x', quantity: 1, unitPrice: 5 }] })
    await db.orders.update(b.id, { status: 'delivered' })
    const user = userEvent.setup()
    renderAt('/', [{ path: '/', element: <OrdersPage /> }])
    expect(await screen.findByText('Karim Saad')).toBeTruthy()
    expect(screen.queryByText('Nour Aziz')).toBeNull()                                     // delivered: hidden by default
    await user.click(screen.getByRole('button', { name: 'Show finished orders' }))
    expect(await screen.findByText('Nour Aziz')).toBeTruthy()
    await user.type(screen.getByRole('searchbox'), '99900')
    await vi.waitFor(() => expect(screen.queryByText('Karim Saad')).toBeNull())
    expect(screen.getByText('Nour Aziz')).toBeTruthy()
    void a
  })
})

describe('label', () => {
  it('draws a QR code that carries the tracking link and prints the code in text', async () => {
    const { order } = await seed()
    const { container } = renderAt(`/orders/${order.id}/label`, [{ path: '/orders/:id/label', element: <LabelPage /> }])
    expect(await screen.findByText(order.public_code)).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('Karim Saad')).toBeTruthy()
    expect(screen.getByText('The final order number appears after syncing')).toBeTruthy()
  })
})

describe('the deposit banner', () => {
  it('says nothing while the rule is off', async () => {
    const { order } = await seed()
    detail(order.id)
    await screen.findByText('Karim Saad')
    expect(screen.queryByText(/deposit/)).toBeNull()
  })

  it('shows exactly what is still owed once the rule is on', async () => {
    session.depositPercent = 40
    const { order } = await seed()                              // total: $50, no payments yet
    detail(order.id)
    expect(await screen.findByText('A deposit of 20.00 USD is required before printing can start.')).toBeTruthy()
  })

  it('drops once enough has been paid, and never applies below the threshold', async () => {
    session.depositPercent = 40
    const { order } = await seed()
    await db.orders.update(order.id, { paid_total: '20' })       // $20 of $50 x 40% = exactly the deposit
    detail(order.id)
    await screen.findByText('Karim Saad')
    expect(screen.queryByText(/deposit/)).toBeNull()

    session.depositThreshold = 100                               // this $50 order is below the threshold
    const second = await seed()
    detail(second.order.id)
    await screen.findByText('Karim Saad')
    expect(screen.queryByText(/deposit/)).toBeNull()
  })
})

describe('the messages section', () => {
  it('sends a message on the customer\'s only consented channel, offline, and shows it in the log', async () => {
    const user = userEvent.setup()
    const { order } = await seed()                               // seeded customer: whatsapp_opt_in true, nothing else
    detail(order.id)
    await screen.findByText('Manual message')
    expect(screen.queryByLabelText('Channel')).toBeNull()         // only one consented channel: nothing to pick

    await user.type(screen.getByPlaceholderText('Write a message to the customer…'), 'your banner is ready')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(() => expect(screen.getByText('your banner is ready')).toBeTruthy())
    // "WhatsApp" and "Not sent to the server yet" each already appear once elsewhere on the page (the contact
    // link, and the order's own sync banner); a second occurrence is the new log entry.
    await vi.waitFor(() => expect(screen.getAllByText(/WhatsApp/)).toHaveLength(2))
    expect(screen.getAllByText(/Not sent to the server yet/)).toHaveLength(2)

    const queued = await db.notification_logs.where('order_id').equals(order.id).first()
    expect(queued).toMatchObject({ channel: 'whatsapp', trigger: 'manual', body: 'your banner is ready', status: 'queued' })
  })

  it('offers a channel picker once the customer has consented to more than one', async () => {
    const { order, customer } = await seed()
    await db.customers.update(customer.id, { sms_opt_in: true })
    const user = userEvent.setup()
    detail(order.id)
    const select = await screen.findByLabelText('Channel') as HTMLSelectElement
    await user.selectOptions(select, 'sms')
    await user.type(screen.getByPlaceholderText('Write a message to the customer…'), 'ready for pickup')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await vi.waitFor(async () => expect(await db.notification_logs.where('order_id').equals(order.id).first()).toMatchObject({ channel: 'sms' }))
  })

  it('has nothing to offer when the customer has not consented to anything', async () => {
    const { order, customer } = await seed()
    await db.customers.update(customer.id, { whatsapp_opt_in: false })
    detail(order.id)
    expect(await screen.findByText('This customer has not consented to any contact channel yet.')).toBeTruthy()
    expect(screen.queryByPlaceholderText('Write a message to the customer…')).toBeNull()
  })

  it('refuses an empty message without queuing anything', async () => {
    const { order } = await seed()
    const user = userEvent.setup()
    detail(order.id)
    await screen.findByText('Manual message')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Write the message text')).toBeTruthy()
    expect(await db.notification_logs.where('order_id').equals(order.id).count()).toBe(0)
  })
})
