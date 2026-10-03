// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({
  dashboard: {} as Record<string, unknown>,
  unpaid: [] as Record<string, unknown>[],
  cashClosing: { rangeStart: '', rangeEnd: '', byMethod: [] as Record<string, unknown>[], entries: [] as Record<string, unknown>[] },
  queue: [] as Record<string, unknown>[],
  dashboardCalls: [] as unknown[][], csvCalls: [] as unknown[][], csvUrl: 'blob:mock-csv',
  dashboardByDate: {} as Record<string, Record<string, unknown>>, failDates: [] as string[],
}))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    reportsApi: {
      dashboard: async (...args: unknown[]) => {
        server.dashboardCalls.push(args)
        if (server.failDates.includes(args[0] as string)) throw new actual.ContentError('server')
        return server.dashboardByDate[args[0] as string] ?? server.dashboard
      },
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
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  session.role = 'admin'
  Object.assign(server, {
    dashboard: { rangeStart: '2026-01-01T00:00:00Z', rangeEnd: '2026-01-02T00:00:00Z', ordersPlaced: 3, revenuePlaced: '150.00', ordersCompleted: 2, cashIn: '80.00', cashOut: '0.00', ordersDueToday: 1 },
    unpaid: [], cashClosing: { rangeStart: '', rangeEnd: '', byMethod: [], entries: [] }, queue: [],
    dashboardCalls: [], csvCalls: [], csvUrl: 'blob:mock-csv', dashboardByDate: {}, failDates: [],
  })
})

const openDashboard = () => renderAt('/reports', [{ path: '/reports', element: <DashboardScreen /> }])
const openUnpaid = () => renderAt('/reports/unpaid', [{ path: '/reports/unpaid', element: <UnpaidScreen /> }])
const openCashClosing = () => renderAt('/reports/cash-closing', [{ path: '/reports/cash-closing', element: <CashClosingScreen /> }])
const openQueue = () => renderAt('/reports/queue', [{ path: '/reports/queue', element: <ProductionQueueScreen /> }])

/** The six days before `iso`, oldest first: what the trend asks for. */
const weekBefore = (iso: string) => [6, 5, 4, 3, 2, 1].map((n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10))
const day = (over: Record<string, unknown>) => ({ rangeStart: '', rangeEnd: '', ordersPlaced: 0, revenuePlaced: '0.00', ordersCompleted: 0, cashIn: '0.00', cashOut: '0.00', ordersDueToday: 0, ...over })

describe('the dashboard screen', () => {
  it('shows today\'s numbers formatted with the shop\'s currency', async () => {
    openDashboard()
    const tiles = within(await screen.findByRole('list', { name: 'The day in numbers', busy: false }))
    expect(tiles.getByText('Orders placed')).toBeTruthy()
    expect(tiles.getByText('3')).toBeTruthy()
    expect(tiles.getByText('150.00 USD')).toBeTruthy()
    expect(tiles.getByText('80.00 USD')).toBeTruthy()
  })

  it('reloads for the chosen date, and the "today"/"yesterday" shortcuts jump straight there', async () => {
    const user = userEvent.setup()
    openDashboard()
    await screen.findByRole('list', { name: 'The day in numbers', busy: false })
    expect(server.dashboardCalls[0]![0]).toBe(new Date().toISOString().slice(0, 10))
    await vi.waitFor(() => expect(server.dashboardCalls).toHaveLength(7))

    await user.click(screen.getByRole('button', { name: 'Yesterday' }))
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    await vi.waitFor(() => expect(server.dashboardCalls).toHaveLength(14))
    expect(server.dashboardCalls[7]![0]).toBe(yesterday)                      // the chosen day first, on its own
    expect(server.dashboardCalls.slice(8).map((c) => c[0])).toEqual(weekBefore(yesterday))
  })
})

describe('the dashboard\'s week and live floor', () => {
  it('shows each figure\'s change against the day before, signed, coloured by whether up is good', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const [prev] = weekBefore(today).slice(-1)
    server.dashboardByDate = {
      [today]: day({ ordersPlaced: 5, revenuePlaced: '200.00', cashOut: '30.00' }),
      [prev!]: day({ ordersPlaced: 3, revenuePlaced: '250.00', cashOut: '10.00' }),
    }
    openDashboard()
    const tiles = within(await screen.findByRole('list', { name: 'The day in numbers', busy: false }))
    const iso = (s: string) => `\u2066${s}\u2069`                         // the signed value is isolated for right-to-left text
    const up = await tiles.findByText(`${iso('+2')} vs the day before`)
    expect(up.parentElement!.className).toContain('text-ok')
    const down = tiles.getByText(`${iso('−50.00 USD')} vs the day before`)
    expect(down.parentElement!.className).toContain('text-magenta')
    expect(tiles.getByText(`${iso('+20.00 USD')} vs the day before`).parentElement!.className).toContain('text-muted')   // paid out: neutral
    expect(tiles.getByText('Orders placed')).toBeTruthy()
  })

  it('charts the week ending on the chosen day, with every value in a table too', async () => {
    const today = new Date().toISOString().slice(0, 10)
    server.dashboardByDate = Object.fromEntries([...weekBefore(today), today].map((d, i) => [d, day({ ordersPlaced: i + 1, revenuePlaced: `${(i + 1) * 10}.00` })]))
    openDashboard()
    const orders = await screen.findByRole('group', { name: 'Orders placed, last 7 days' })
    expect(within(orders).getAllByRole('img')).toHaveLength(7)                 // one focusable target per day
    const tables = screen.getAllByRole('table', { hidden: true })
    expect(within(tables[0]!).getAllByRole('row', { hidden: true })).toHaveLength(8)   // header + 7 days
    expect(within(tables[1]!).getByText('70.00 USD')).toBeTruthy()
  })

  it('keeps the day\'s numbers when the week behind it fails to load', async () => {
    server.failDates = weekBefore(new Date().toISOString().slice(0, 10)).slice(0, 1)
    openDashboard()
    expect(await screen.findByText('The last 7 days could not be loaded. The day above is up to date.')).toBeTruthy()
    expect(within(await screen.findByRole('list', { name: 'The day in numbers', busy: false })).getByText('150.00 USD')).toBeTruthy()
  })

  it('counts this device\'s open orders by stage, and flags the ones past due', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })
    const make = async (status: string, dueAt: string | null = null) => {
      const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Flyer', quantity: 1, unitPrice: 5 }] })
      await db.orders.update(order.id, { status, due_at: dueAt })
    }
    await make('printing'); await make('printing', '2020-01-01T00:00:00Z'); await make('ready'); await make('delivered')
    openDashboard()
    const floor = within(await screen.findByRole('region', { name: 'On the floor now' }))
    expect(await floor.findByText('3 open order(s)')).toBeTruthy()             // delivered is not on the floor
    expect(floor.getByText('1 past due')).toBeTruthy()
    const printing = floor.getByText('Printing').closest('li')!
    expect(within(printing).getByText('2')).toBeTruthy()
    expect(printing.querySelector('.status-dot.live')).toBeTruthy()             // machines running: the light pulses
    expect(floor.getByRole('link', { name: /Open the board/ }).getAttribute('href')).toBe('/?view=board')
  })
})

describe('the machine status placeholder', () => {
  it('says plainly that it is coming soon, and shows no machine figures at all', async () => {
    openDashboard()
    const panel = within(await screen.findByRole('region', { name: 'Machine status' }))
    expect(panel.getByText('Coming soon')).toBeTruthy()
    expect(panel.getByText(/No machine data is collected yet/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Machine status' }).textContent).not.toMatch(/[0-9]/)   // nothing made up
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
