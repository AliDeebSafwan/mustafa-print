// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'receptionist', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { ReconciliationPage } from '../../src/pages/ReconciliationPage'
import { createCustomerLocally, createOrderLocally, recordPaymentLocally } from '../../src/offline/actions'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'receptionist' })

async function collect(amount: string) {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: `+9617${Math.floor(1e6 + Math.random() * 9e6)}`, whatsappOptIn: false })
  const order = await createOrderLocally({ customerId: customer.id, fulfillmentType: 'delivery', deliveryAddress: 'Cedar street', items: [{ name: 'Banner', quantity: 1, unitPrice: Number(amount) }] })
  return recordPaymentLocally({ orderId: order.id, type: 'payment', method: 'cod', amount })
}
const open = () => renderAt('/reconcile', [{ path: '/reconcile', element: <ReconciliationPage /> }])

describe('cash-on-delivery reconciliation', () => {
  it('shows an empty state when nothing is owed', async () => {
    open()
    expect(await screen.findByText('No cash waiting to be handed in.')).toBeTruthy()
  })

  it('lists every unsettled collection with its total, and settling one leaves the other untouched', async () => {
    await collect('25')
    await collect('100')
    const user = userEvent.setup()
    open()
    // the top shows the running total (125.00), and each row shows its own amount once
    expect(await screen.findByText('125.00 USD')).toBeTruthy()
    expect(screen.getByText('100.00 USD', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('25.00 USD', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('2 collection(s)')).toBeTruthy()

    const row = screen.getByText('100.00 USD', { selector: 'span' }).closest('li')!
    await user.click(row.querySelector('button')!)
    expect(await screen.findByText('Recorded the hand-over. Sent once online.')).toBeTruthy()
    await vi.waitFor(() => expect(screen.queryAllByText('100.00 USD')).toHaveLength(0))   // settled: no longer listed
    expect(screen.getByText('25.00 USD', { selector: 'span' })).toBeTruthy()               // the other collection is untouched
  })

  it('settle all clears every row in one action', async () => {
    await collect('25')
    await collect('40')
    const user = userEvent.setup()
    open()
    await screen.findByText('2 collection(s)')
    await user.click(screen.getByRole('button', { name: 'Settle all' }))
    expect(await screen.findByText('Recorded 2 hand-over(s). Sent once online.')).toBeTruthy()
    await vi.waitFor(async () => expect(await screen.findByText('No cash waiting to be handed in.')).toBeTruthy())
  })

  it('is refused to a role without transactions:settle, but the amount owed is still visible', async () => {
    session.role = 'machine_operator'
    await collect('40')
    open()
    expect(await screen.findAllByText('40.00 USD')).toHaveLength(2)   // the running total and the one row show the same amount
    expect(screen.queryByRole('button', { name: 'Settle' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settle all' })).toBeNull()
  })
})
