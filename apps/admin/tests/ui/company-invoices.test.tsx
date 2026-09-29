// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'staff', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({ unbilled: [] as Record<string, unknown>[], issued: [] as unknown[][], invoice: {} as Record<string, unknown>, fail: null as string | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    companyInvoicesApi: {
      unbilled: async () => server.unbilled,
      list: async () => [],
      get: async () => server.invoice,
      issue: async (...args: unknown[]) => { if (server.fail) throw new actual.ContentError('invalid_request', server.fail); server.issued.push(args); return { ...server.invoice, id: 'inv-1' } },
    },
  }
})

import { CompanyInvoicesPage } from '../../src/pages/companies/CompanyInvoicesPage'
import { CompanyInvoicePage } from '../../src/pages/companies/CompanyInvoicePage'
import { renderAt, resetApp } from './harness'

const order = (id: string, n: string, total: string) => ({ id, order_number: n, public_code: 'X', status: 'delivered', placed_at: '2026-09-01T10:00:00Z', currency: 'USD', net: total, tax_total: '0.00', total })
beforeEach(async () => {
  await resetApp('en')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  Object.assign(server, {
    unbilled: [order('o1', '11', '20.00'), order('o2', '12', '35.50'), order('o3', '13', '4.50')], issued: [], fail: null,
    invoice: { id: 'inv-1', invoice_number: '3', currency: 'USD', subtotal: '150.00', tax_total: '16.50', total: '166.50', order_count: 2, issued_at: '2026-09-30T10:00:00Z',
      customer_id: 'c1', full_name: 'Nadia', company_name: 'Haddad Supplies', customer_tax_number: 'LB-777', address_line: null, city: 'Beirut',
      legal_name_ar: 'مطبعة المصطفى ش.م.ل', legal_name_en: 'Al-Mustafa Print SAL', name_ar: 'المصطفى', name_en: 'Mustafa', shop_tax_number: 'LB-1',
      invoice_footer_ar: null, invoice_footer_en: 'Thank you', vat_enabled: true, vat_rate_percent: '11',
      orders: [{ id: 'o1', order_number: '11', public_code: 'X', placed_at: '2026-09-01T10:00:00Z', net: '100.00', tax_total: '11.00', total: '111.00' }] },
  })
})
const open = () => renderAt('/customers/c1/invoices', [
  { path: '/customers/:id/invoices', element: <CompanyInvoicesPage /> },
  { path: '/company-invoices/:id', element: <p>INVOICE PAGE</p> },
])

describe('consolidated invoices', () => {
  it('selects every unbilled order by default, and leaving one out changes the total and what is sent', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('60.00 USD')).toBeTruthy()          // 20 + 35.50 + 4.50
    await user.click(screen.getByRole('checkbox', { name: '#13' }))
    expect(screen.getByText('55.50 USD', { selector: 'span' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Issue consolidated invoice' }))
    expect(await screen.findByText('INVOICE PAGE')).toBeTruthy()
    expect(server.issued).toEqual([['c1', ['o1', 'o2']]])
  })

  it('explains a race with another person in plain words', async () => {
    server.fail = 'already_invoiced'
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Issue consolidated invoice' }))
    expect((await screen.findByRole('alert')).textContent).toBe('One of the selected orders was just invoiced. Refresh and try again.')
  })

  it('prints the company, both tax numbers, and the net and VAT split, in either language', async () => {
    const user = userEvent.setup()
    renderAt('/company-invoices/inv-1', [{ path: '/company-invoices/:id', element: <CompanyInvoicePage /> }])
    expect(await screen.findByText('Haddad Supplies')).toBeTruthy()
    expect(screen.getByText('LB-777')).toBeTruthy()
    expect(screen.getByText('VAT (11%)')).toBeTruthy()
    expect(screen.getByText('166.50 USD')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'العربية' }))
    expect(await screen.findByText('فاتورة مجمّعة')).toBeTruthy()
    expect(screen.getByText('مطبعة المصطفى ش.م.ل')).toBeTruthy()
  })
})
