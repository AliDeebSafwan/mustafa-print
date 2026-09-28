// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({
  dashboard: {} as Record<string, unknown>,
  unpaid: [] as Record<string, unknown>[],
  cashClosing: { rangeStart: '', rangeEnd: '', byMethod: [] as Record<string, unknown>[], entries: [] as Record<string, unknown>[] },
  queue: [] as Record<string, unknown>[],
  dashboardCalls: [] as unknown[][], csvCalls: [] as unknown[][], csvUrl: 'blob:mock-csv',
}))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    reportsApi: {
      dashboard: async (...args: unknown[]) => { server.dashboardCalls.push(args); return server.dashboard },
      unpaid: async () => server.unpaid,
      cashClosing: async () => server.cashClosing,
      productionQueue: async () => server.queue,
      csvUrl: async (...args: unknown[]) => { server.csvCalls.push(args); return server.csvUrl },
    },
  }
})

import { CashClosingScreen } from '../../src/pages/reports/CashClosingScreen'
import { DashboardScreen } from '../../src/pages/reports/DashboardScreen'
import { ProductionQueueScreen } from '../../src/pages/reports/ProductionQueueScreen'
import { UnpaidScreen } from '../../src/pages/reports/UnpaidScreen'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  session.role = 'admin'
  Object.assign(server, {
    dashboard: { rangeStart: '2026-01-01T00:00:00Z', rangeEnd: '2026-01-02T00:00:00Z', ordersPlaced: 3, revenuePlaced: '150.00', ordersCompleted: 2, cashIn: '80.00', cashOut: '0.00', ordersDueToday: 1 },
    unpaid: [], cashClosing: { rangeStart: '', rangeEnd: '', byMethod: [], entries: [] }, queue: [],
    dashboardCalls: [], csvCalls: [], csvUrl: 'blob:mock-csv',
  })
})

const openDashboard = () => renderAt('/reports', [{ path: '/reports', element: <DashboardScreen /> }])
const openUnpaid = () => renderAt('/reports/unpaid', [{ path: '/reports/unpaid', element: <UnpaidScreen /> }])
const openCashClosing = () => renderAt('/reports/cash-closing', [{ path: '/reports/cash-closing', element: <CashClosingScreen /> }])
const openQueue = () => renderAt('/reports/queue', [{ path: '/reports/queue', element: <ProductionQueueScreen /> }])

describe('the dashboard screen', () => {
  it('shows today\'s numbers formatted with the shop\'s currency', async () => {
    openDashboard()
    expect(await screen.findByText('Orders placed')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('150.00 USD')).toBeTruthy()
    expect(screen.getByText('80.00 USD')).toBeTruthy()
  })

  it('reloads for the chosen date, and the "today"/"yesterday" shortcuts jump straight there', async () => {
    const user = userEvent.setup()
    openDashboard()
    await screen.findByText('Orders placed')
    expect(server.dashboardCalls[0]![0]).toBe(new Date().toISOString().slice(0, 10))

    await user.click(screen.getByRole('button', { name: 'Yesterday' }))
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    await vi.waitFor(() => expect(server.dashboardCalls.at(-1)![0]).toBe(yesterday))
  })
})

describe('the unpaid balances screen', () => {
  it('shows an empty state when everything is settled', async () => {
    openUnpaid()
    expect(await screen.findByText('No unpaid balances. Everything is settled.')).toBeTruthy()
  })

  it('lists what is owed, with a running total, and links to the order', async () => {
    server.unpaid = [
      { id: 'o1', public_code: 'ABC123', order_number: '10', placed_at: '2026-01-01T10:00:00Z', status: 'received', payment_status: 'partial', currency: 'USD', total: '100.00', paid_total: '40.00', remaining: '60.00', customer_name: 'Karim Saad', customer_phone: '+96170123456' },
      { id: 'o2', public_code: 'XYZ789', order_number: '11', placed_at: '2026-01-02T10:00:00Z', status: 'printing', payment_status: 'unpaid', currency: 'USD', total: '25.00', paid_total: '0.00', remaining: '25.00', customer_name: 'Rana Khalil', customer_phone: null },
    ]
    openUnpaid()
    expect(await screen.findByText('Karim Saad')).toBeTruthy()
    expect(screen.getByText('60.00 USD')).toBeTruthy()
    expect(screen.getByText('85.00 USD')).toBeTruthy()         // 60 + 25 running total
    expect(screen.getByRole('link', { name: /Karim Saad/ }).getAttribute('href')).toBe('/orders/o1')
  })

  it('downloads the CSV through the reports client, not a plain link', async () => {
    server.unpaid = [{ id: 'o1', public_code: 'ABC', order_number: null, placed_at: '2026-01-01T10:00:00Z', status: 'received', payment_status: 'unpaid', currency: 'USD', total: '10', paid_total: '0', remaining: '10', customer_name: 'X', customer_phone: null }]
    const user = userEvent.setup()
    openUnpaid()
    await screen.findByText('X')
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    await vi.waitFor(() => expect(server.csvCalls).toHaveLength(1))
    expect(server.csvCalls[0]).toEqual(['/unpaid'])
  })
})

describe('the cash closing screen', () => {
  it('nets payments against refunds, and breaks down by method', async () => {
    server.cashClosing = {
      rangeStart: '', rangeEnd: '',
      byMethod: [
        { method: 'cash', txn_type: 'payment', amount: '80.00', count: 3 },
        { method: 'cod', txn_type: 'payment', amount: '20.00', count: 1 },
        { method: 'cash', txn_type: 'refund', amount: '15.00', count: 1 },
      ],
      entries: [{ id: 't1', txn_type: 'refund', method: 'cash', amount: '15.00', till_at: '2026-01-01T12:00:00Z', note: null, public_code: 'ABC', order_number: '5', customer_name: 'Karim Saad', handled_by_name: 'Owner' }],
    }
    openCashClosing()
    expect(await screen.findByText('Net collected')).toBeTruthy()
    expect(screen.getByText('85.00 USD')).toBeTruthy()   // 80 + 20 - 15
    expect(screen.getAllByText('Cash')).toHaveLength(2)   // one payment row, one refund row
    expect(screen.getByText('On delivery')).toBeTruthy()
    expect(screen.getByText('Refund')).toBeTruthy()
    expect(screen.getByText('−15.00 USD')).toBeTruthy()
  })

  it('shows an empty state for a quiet day', async () => {
    openCashClosing()
    expect(await screen.findByText('No entries on this day.')).toBeTruthy()
    expect(screen.getByText('0.00 USD')).toBeTruthy()
  })
})

describe('the production queue screen', () => {
  it('lists open orders and flags an overdue one', async () => {
    server.queue = [
      { id: 'o1', public_code: 'ABC', order_number: '1', status: 'printing', due_at: '2020-01-01T00:00:00Z', placed_at: '2026-01-01T00:00:00Z', fulfillment_type: 'pickup', customer_name: 'Karim Saad', customer_phone: null },
      { id: 'o2', public_code: 'DEF', order_number: '2', status: 'received', due_at: null, placed_at: '2026-01-01T00:00:00Z', fulfillment_type: 'pickup', customer_name: 'Rana Khalil', customer_phone: null },
    ]
    openQueue()
    expect(await screen.findByText('Karim Saad')).toBeTruthy()
    expect(screen.getByText('2 order(s) in progress')).toBeTruthy()
    expect(screen.getByText(/Printing/)).toBeTruthy()
  })

  it('shows an empty state when nothing is in progress', async () => {
    openQueue()
    expect(await screen.findByText('Nothing in progress. Everything is done or delivered.')).toBeTruthy()
  })
})
