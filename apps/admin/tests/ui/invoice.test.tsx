// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({
  role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null,
  legalNameAr: null as string | null, legalNameEn: null as string | null, taxNumber: null as string | null,
  vatEnabled: false, vatRatePercent: 0, invoiceFooterAr: null as string | null, invoiceFooterEn: null as string | null,
}))
const server = vi.hoisted(() => ({ issued: [] as unknown[][], failNext: null as null | string, response: {} as Record<string, unknown> }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    ordersApi: {
      issueInvoice: async (...args: unknown[]) => {
        server.issued.push(args)
        if (server.failNext) { const code = server.failNext; server.failNext = null; throw new actual.ContentError(code as never) }
        return server.response
      },
    },
  }
})

import { InvoicePage } from '../../src/pages/InvoicePage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  Object.assign(session, { role: 'admin', legalNameAr: null, legalNameEn: null, taxNumber: null, vatEnabled: false, vatRatePercent: 0, invoiceFooterAr: null, invoiceFooterEn: null })
  Object.assign(server, { issued: [], failNext: null, response: {} })
  window.print = vi.fn()
})

async function seedOrder(over: Record<string, unknown> = {}) {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: false, locale: 'en' })
  await db.customers.update(customer.id, { email: 'karim@example.com' })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Cards', quantity: 500, unitPrice: 0.1 }] })
  await db.orders.update(order.id, { _pending: false, subtotal: '50.00', total: '50.00', paid_total: '0', ...over })
  return order
}
const open = (id: string) => renderAt(`/orders/${id}/invoice`, [{ path: '/orders/:id/invoice', element: <InvoicePage /> }])

describe('the invoice page', () => {
  it('offers to issue and print when the order has no invoice yet', async () => {
    const order = await seedOrder()
    open(order.id)
    expect(await screen.findByText('Not yet issued')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Issue and print' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
  })

  it('issues the number, shows it immediately, and opens the print dialog', async () => {
    const order = await seedOrder()
    server.response = { invoice_number: '7', invoice_issued_at: '2026-01-05T10:00:00Z' }
    const user = userEvent.setup()
    open(order.id)
    await user.click(await screen.findByRole('button', { name: 'Issue and print' }))
    expect(await screen.findByText('#7')).toBeTruthy()
    expect(server.issued[0]).toEqual([order.id])
    await vi.waitFor(() => expect(window.print).toHaveBeenCalled())
    expect((await db.orders.get(order.id))!.invoice_number).toBe('7')
  })

  it('once issued, reprinting never asks the server for a new number', async () => {
    const order = await seedOrder({ invoice_number: '12', invoice_issued_at: '2026-01-01T00:00:00Z' })
    const user = userEvent.setup()
    open(order.id)
    expect(await screen.findByText('#12')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(window.print).toHaveBeenCalled()
    expect(server.issued).toHaveLength(0)
  })

  it('explains an offline failure without crashing', async () => {
    const order = await seedOrder()
    server.failNext = 'offline'
    const user = userEvent.setup()
    open(order.id)
    await user.click(await screen.findByRole('button', { name: 'Issue and print' }))
    expect(await screen.findByText('No internet connection. Issuing needs one.')).toBeTruthy()
    expect(screen.getByText('Not yet issued')).toBeTruthy()
  })

  it('uses the legal name once set, and falls back to the shop\'s ordinary name otherwise', async () => {
    const order = await seedOrder()
    const view = open(order.id)
    expect(await screen.findByText('Mustafa')).toBeTruthy()   // the harness's default trade name
    view.unmount()

    session.legalNameEn = 'Al-Mustafa Printing Co.'
    open(order.id)
    expect(await screen.findByText('Al-Mustafa Printing Co.')).toBeTruthy()
  })

  it('shows the VAT line only when the order actually has tax on it', async () => {
    session.vatRatePercent = 11
    const noTax = await seedOrder()
    const view = open(noTax.id)
    await screen.findByText('Karim Saad')
    expect(screen.queryByText(/VAT/)).toBeNull()
    view.unmount()

    const taxed = await seedOrder({ tax_total: '5.50', total: '55.50' })
    open(taxed.id)
    expect(await screen.findByText('VAT (11%)')).toBeTruthy()
    expect(screen.getByText('5.50 USD')).toBeTruthy()
  })

  it('switches between Arabic and English on demand', async () => {
    const order = await seedOrder()
    const user = userEvent.setup()
    open(order.id)
    await screen.findByText('Not yet issued')
    await user.click(screen.getByRole('button', { name: 'عربي' }))
    expect(await screen.findByText('لم تُصدر بعد')).toBeTruthy()
  })
})
