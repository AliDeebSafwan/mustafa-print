// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[], detail: {} as Record<string, unknown>,
  listCalls: [] as unknown[][], merges: [] as unknown[][], deactivated: [] as unknown[][], failNext: null as null | { code: string; detail?: string },
}))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  const fail = () => { if (server.failNext) { const f = server.failNext; server.failNext = null; throw new actual.ContentError(f.code as never, f.detail) } }
  return {
    ...actual,
    customerAccountsApi: {
      list: async (...args: unknown[]) => { server.listCalls.push(args); return server.list },
      detail: async () => server.detail,
      deactivate: async (...args: unknown[]) => { fail(); server.deactivated.push(args); server.detail = { ...server.detail, is_active: false }; return {} },
      reactivate: async () => { server.detail = { ...server.detail, is_active: true }; return {} },
      merge: async (...args: unknown[]) => { fail(); server.merges.push(args); return { orders_moved: 1 } },
    },
  }
})

import { CustomerAccountsPage } from '../../src/pages/customers/CustomerAccountsPage'
import { createCustomerLocally } from '../../src/offline/actions'
import { renderAt, resetApp } from './harness'

const account = { id: 'a1', email: 'walid@example.com', full_name: 'Walid Haddad', phone_e164: '+96171222333', is_active: true, email_verified_at: '2026-01-01T10:00:00Z', created_at: '2026-01-01T09:00:00Z', customer_id: 'c-web', customer_name: 'Walid Haddad', order_count: 1 }

beforeEach(async () => {
  await resetApp('en')
  Object.assign(server, {
    list: [account, { ...account, id: 'a2', email: 'new@example.com', full_name: 'Not Confirmed', email_verified_at: null, customer_id: null, order_count: 0 }],
    detail: { ...account, locale: 'ar', customer_phone: null, orders: [{ id: 'o1', public_code: 'ABC123', order_number: '12', status: 'received', total: '40.00', currency: 'USD', placed_at: '2026-01-02T10:00:00Z' }],
      candidates: [{ id: 'c-counter', full_name: 'Walid Haddad', phone_e164: '+96171222333', email: null, order_count: 3 }] },
    listCalls: [], merges: [], deactivated: [], failNext: null,
  })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
const open = () => renderAt('/customer-accounts', [{ path: '/customer-accounts', element: <CustomerAccountsPage /> }])

describe('the website accounts screen', () => {
  it('lists accounts, marks an unconfirmed one, and searches', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('Walid Haddad')).toBeTruthy()
    expect(screen.getByText('Email not confirmed yet')).toBeTruthy()
    await user.type(screen.getByPlaceholderText('Search by name, email or phone'), 'walid')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await vi.waitFor(() => expect(server.listCalls.at(-1)).toEqual(['walid']))
  })

  it('shows one account with its orders, and disables it after a confirmation', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Walid Haddad/ }))
    expect(await screen.findByText('#12')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Disable account' }))
    expect(await screen.findByText('Account disabled and signed out everywhere.')).toBeTruthy()
    expect(server.deactivated).toEqual([['a1']])
    expect(await screen.findByRole('button', { name: 'Re-enable account' })).toBeTruthy()
  })

  it('merges into the suggested counter customer', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Walid Haddad/ }))
    await screen.findByText('Possible matches (same phone or name):')
    await user.click(screen.getByRole('button', { name: 'Merge into' }))
    expect(await screen.findByText('Merged into "Walid Haddad".')).toBeTruthy()
    expect(server.merges).toEqual([['a1', 'c-counter']])
  })

  it('merges into a counter customer found by searching this device, when nothing was suggested', async () => {
    server.detail = { ...server.detail, candidates: [] }
    const { customer } = await createCustomerLocally({ fullName: 'W. Haddad (old record)', phone: '+96103444555', whatsappOptIn: false })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Walid Haddad/ }))
    await user.type(await screen.findByPlaceholderText('Or search for a customer by name or phone'), 'old record')
    await user.click(await screen.findByRole('button', { name: 'Merge into' }))
    await vi.waitFor(() => expect(server.merges).toEqual([['a1', customer.id]]))
  })

  it('explains a refused merge in plain words', async () => {
    server.failNext = { code: 'invalid_request', detail: 'target_has_account' }
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Walid Haddad/ }))
    await user.click(await screen.findByRole('button', { name: 'Merge into' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That customer is already tied to another website account.')
  })
})
