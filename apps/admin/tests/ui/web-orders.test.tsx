// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({ setFee: [] as unknown[][], files: [] as unknown[], failFee: null as null | string }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    ordersApi: {
      files: async () => server.files,
      fileUrl: async () => 'blob:mock',
      setDeliveryFee: async (...args: unknown[]) => {
        server.setFee.push(args)
        if (server.failFee) throw new actual.ContentError(server.failFee as never)
        return {}
      },
    },
  }
})

import { OrderDetailPage } from '../../src/pages/orders/OrderDetailPage'
import { OrdersPage } from '../../src/pages/orders/OrdersPage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'admin'; server.setFee = []; server.files = []; server.failFee = null })

async function webOrder(over: Record<string, unknown> = {}) {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: false })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Cards', quantity: 1, unitPrice: 25 }], ...over })
  await db.orders.update(order.id, { source: 'web', _pending: false, ...over })
  return order
}
const detail = (id: string) => renderAt(`/orders/${id}`, [{ path: '/orders/:id', element: <OrderDetailPage /> }])

describe('a delivery order waiting for a price', () => {
  it('the owner sets the fee and the order shows the new total', async () => {
    const order = await webOrder({ delivery_fee_pending: true, fulfillment_type: 'delivery', delivery_address: 'Main street', total: '25.00' })
    const user = userEvent.setup()
    detail(order.id)
    expect(await screen.findByText('Delivery order waiting for your price')).toBeTruthy()
    await user.type(screen.getByLabelText(/Delivery fee/), '0')
    await user.click(screen.getByRole('button', { name: 'Set the fee' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a valid amount above zero')
    expect(server.setFee).toHaveLength(0)

    await user.clear(screen.getByLabelText(/Delivery fee/))
    await user.type(screen.getByLabelText(/Delivery fee/), '6.5')
    expect(await screen.findByText('New total: 31.50 USD')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Set the fee' }))
    await vi.waitFor(() => expect(server.setFee).toHaveLength(1))
    expect(server.setFee[0]).toEqual([order.id, '6.5'])
  })

  it('a receptionist without the permission only sees that it is pending', async () => {
    const order = await webOrder({ delivery_fee_pending: true, fulfillment_type: 'delivery' })
    session.role = 'receptionist'
    detail(order.id)
    expect(await screen.findByText('A delivery order waiting for the owner to set its fee.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set the fee' })).toBeNull()
  })

  it('shows an offline error without losing the typed amount', async () => {
    server.failFee = 'offline'
    const order = await webOrder({ delivery_fee_pending: true, fulfillment_type: 'delivery' })
    const user = userEvent.setup()
    detail(order.id)
    await user.type(await screen.findByLabelText(/Delivery fee/), '5')
    await user.click(screen.getByRole('button', { name: 'Set the fee' }))
    expect((await screen.findByRole('alert')).textContent).toBe('No internet connection. Managing the website needs one.')
    expect((screen.getByLabelText(/Delivery fee/) as HTMLInputElement).value).toBe('5')
  })
})

describe('a web order\'s files', () => {
  it('lists them and starts a download without navigating away', async () => {
    server.files = [{ id: 'f1', order_item_id: null, original_name: 'design.pdf', kind: 'pdf', bytes: '2097152', created_at: '2026-01-01' }]
    const order = await webOrder()
    const user = userEvent.setup()
    detail(order.id)
    expect(await screen.findByText('Customer files')).toBeTruthy()
    expect(screen.getByText('design.pdf')).toBeTruthy()
    expect(screen.getByText('2.0 MB')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /design.pdf/ }))
    // no navigation and no crash: the click only triggers the (mocked) blob download
    expect(await screen.findByText('Customer files')).toBeTruthy()
  })

  it('shows nothing for an order with no files, and never for a staff-created order', async () => {
    server.files = []
    const webNoFiles = await webOrder()
    const view = detail(webNoFiles.id)
    await screen.findByText(/Cards/)
    expect(screen.queryByText('Customer files')).toBeNull()
    view.unmount()

    const { customer } = await createCustomerLocally({ fullName: 'Staff Customer', phone: '+96170999888', whatsappOptIn: false })
    const staffOrder = await createOrderLocally({ customerId: customer.id, items: [{ name: 'x', quantity: 1, unitPrice: 5 }] })
    detail(staffOrder.id)
    await screen.findByText('Staff Customer')
    expect(screen.queryByText('Customer files')).toBeNull()
  })
})

describe('the orders list', () => {
  it('marks website orders and filters to show only them', async () => {
    const web = await webOrder()
    const { customer } = await createCustomerLocally({ fullName: 'Counter Customer', phone: '+96170111222', whatsappOptIn: false })
    await createOrderLocally({ customerId: customer.id, items: [{ name: 'x', quantity: 1, unitPrice: 5 }] })
    const user = userEvent.setup()
    renderAt('/', [{ path: '/', element: <OrdersPage /> }])
    expect(await screen.findByText('Counter Customer')).toBeTruthy()
    expect(screen.getAllByText(/from the website/).length).toBe(1)
    await user.click(screen.getByRole('checkbox', { name: 'Website orders only' }))
    expect(screen.queryByText('Counter Customer')).toBeNull()
    expect(await screen.findByText('Karim Saad')).toBeTruthy()
    void web
  })

  it('flags an order that still needs delivery pricing', async () => {
    await webOrder({ delivery_fee_pending: true, fulfillment_type: 'delivery' })
    renderAt('/', [{ path: '/', element: <OrdersPage /> }])
    expect(await screen.findByText('Needs delivery pricing')).toBeTruthy()
  })
})
