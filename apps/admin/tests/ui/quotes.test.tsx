// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'staff', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({ list: [] as Record<string, unknown>[], detail: {} as Record<string, unknown>, created: [] as unknown[], cancelled: [] as unknown[] }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    quotesApi: {
      list: async () => server.list,
      detail: async () => server.detail,
      create: async (input: unknown) => { server.created.push(input); return { ...server.detail, id: 'q-new' } },
      cancel: async (id: string) => { server.cancelled.push(id); server.detail = { ...server.detail, status: 'cancelled' }; return server.detail },
    },
  }
})

import { QuotesPage } from '../../src/pages/orders/QuotesPage'
import { createCustomerLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

const detail = {
  id: 'q1', quote_number: '7', public_code: 'ABCDEFGHJK12', status: 'sent', total: '45.00', currency: 'USD', valid_until: '2026-12-01T00:00:00Z',
  created_at: '2026-11-01T00:00:00Z', customer_name: 'Karim Saad', customer_phone: '+96170123456', subtotal: '45.00', discount_total: '0.00',
  tax_total: '0.00', notes: null, internal_notes: null, decline_reason: null, order_id: null, accepted_at: null, customer_id: 'c1',
  items: [{ name: 'Flyers A5', quantity: '500', unit_price: '0.04', discount: '0', line_total: '20.00', notes: null }],
  link: 'https://print.example.com/ar/quote/ABCDEFGHJK12',
}

beforeEach(async () => {
  await resetApp('en')
  session.role = 'staff'
  Object.assign(server, { list: [{ ...detail }, { ...detail, id: 'q2', quote_number: '8', status: 'expired', customer_name: 'Rana Khalil' }], detail: { ...detail }, created: [], cancelled: [] })
})
const open = () => renderAt('/quotes', [{ path: '/quotes', element: <QuotesPage /> }])

async function syncedCustomer() {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })
  await db.customers.update(customer.id, { _pending: false })   // as if it already reached the server
  return customer
}

describe('the quotes screen', () => {
  it('lists quotes with their status in words', async () => {
    open()
    expect(await screen.findByText('Rana Khalil')).toBeTruthy()
    expect(screen.getByText('Awaiting reply')).toBeTruthy()
    expect(screen.getByText('Expired')).toBeTruthy()
  })

  it('writes a quote with the usual item editor and sends exactly what was typed', async () => {
    const customer = await syncedCustomer()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'New quote' }))
    await user.click(screen.getByRole('button', { name: 'Issue the quote' }))
    expect(await screen.findByRole('alert')).toBeTruthy()             // no customer, no items: nothing is sent
    expect(server.created).toHaveLength(0)

    await user.type(screen.getByLabelText('Find a customer by name or phone'), 'Karim')
    await user.click(await screen.findByRole('button', { name: /Karim Saad/ }))
    await user.type(screen.getByPlaceholderText('Item description'), 'Flyers A5')
    await user.clear(screen.getByLabelText('Qty'))
    await user.type(screen.getByLabelText('Qty'), '500')
    await user.type(screen.getByLabelText('Unit price'), '0.04')
    await user.clear(screen.getByLabelText('Valid for (days)'))
    await user.type(screen.getByLabelText('Valid for (days)'), '7')
    await user.click(screen.getByRole('button', { name: 'Issue the quote' }))

    await vi.waitFor(() => expect(server.created).toHaveLength(1))
    expect(server.created[0]).toEqual({ customer_id: customer.id, valid_days: 7, items: [{ name: 'Flyers A5', quantity: '500', unit_price: '0.04' }] })
    expect(await screen.findByRole('button', { name: 'Copy the quote link for the customer' })).toBeTruthy()
  })

  it('does not send a quote for a customer that has not reached the server yet', async () => {
    await createCustomerLocally({ fullName: 'Brand New', phone: '+96170999000', whatsappOptIn: false })   // still pending
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'New quote' }))
    await user.type(screen.getByLabelText('Find a customer by name or phone'), 'Brand')
    await user.click(await screen.findByRole('button', { name: /Brand New/ }))
    await user.type(screen.getByPlaceholderText('Item description'), 'x')
    await user.type(screen.getByLabelText('Qty'), '1')
    await user.type(screen.getByLabelText('Unit price'), '5')
    await user.click(screen.getByRole('button', { name: 'Issue the quote' }))
    expect(await screen.findByText(/has not reached the server yet/)).toBeTruthy()
    expect(server.created).toHaveLength(0)
  })

  it('shares an open quote on WhatsApp with its link, and withdraws it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Karim Saad/ }))
    const whatsapp = await screen.findByRole('link', { name: 'Send it on WhatsApp' })
    expect(whatsapp.getAttribute('href')).toContain('https://wa.me/96170123456?text=')
    expect(decodeURIComponent(whatsapp.getAttribute('href')!)).toContain(detail.link)

    await user.click(screen.getByRole('button', { name: 'Withdraw the quote' }))
    await vi.waitFor(() => expect(server.cancelled).toEqual(['q1']))
    expect(await screen.findByText(/Withdrawn/)).toBeTruthy()
  })

  it('an accepted quote leads straight to the order it became', async () => {
    server.detail = { ...detail, status: 'accepted', order_id: 'o-9' }
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Karim Saad/ }))
    expect((await screen.findByRole('link', { name: 'Open the order it became' })).getAttribute('href')).toBe('/orders/o-9')
  })
})
