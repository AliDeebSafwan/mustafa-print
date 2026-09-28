// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestSync = vi.hoisted(() => vi.fn())
vi.mock('../../src/offline/request-sync', () => ({ requestSync }))

import { MessagesSection } from '../../src/components/order/MessagesSection'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db, type CustomerRow } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); requestSync.mockClear() })

async function seed(over: Partial<CustomerRow> = {}) {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Cards', quantity: 1, unitPrice: 25 }] })
  if (Object.keys(over).length > 0) await db.customers.update(customer.id, over)
  const updated = (await db.customers.get(customer.id))!
  return { customer: updated, order }
}
const open = (customer: CustomerRow, orderId: string) => renderAt('/x', [{ path: '/x', element: <MessagesSection orderId={orderId} customer={customer} lang="en" /> }])

describe('the manual message composer', () => {
  it('offers nothing to send when the customer has not consented to any channel', async () => {
    const { customer, order } = await seed({ whatsapp_opt_in: false })
    open(customer, order.id)
    expect(await screen.findByText('This customer has not consented to any contact channel yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('skips the channel picker when only one channel is available', async () => {
    const { customer, order } = await seed()   // whatsapp only, from the default fixture
    open(customer, order.id)
    await screen.findByRole('button', { name: 'Send' })
    expect(screen.queryByLabelText('Channel')).toBeNull()
  })

  it('offers a channel picker once the customer consented to more than one', async () => {
    const { customer, order } = await seed({ sms_opt_in: true })
    open(customer, order.id)
    const select = (await screen.findByLabelText('Channel')) as HTMLSelectElement
    expect([...select.options].map((o) => o.value).sort()).toEqual(['sms', 'whatsapp'])
  })

  it('refuses an empty message, then sends and shows it in the log at once', async () => {
    const { customer, order } = await seed()
    const user = userEvent.setup()
    open(customer, order.id)
    await user.click(await screen.findByRole('button', { name: 'Send' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Write the message text')

    const textarea = screen.getByPlaceholderText('Write a message to the customer…') as HTMLTextAreaElement
    await user.type(textarea, 'your order is ready')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    // wait for the log to actually show the new entry — a real signal that Dexie's live query re-rendered,
    // not just that requestSync() was called synchronously (which can race ahead of React's own commit)
    expect(await screen.findByText(/Not sent to the server yet/)).toBeTruthy()
    expect(requestSync).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('')
    expect(screen.getAllByText('your order is ready')).toHaveLength(1)   // only in the log now, not still sitting in the form too
  })

  it('shows past messages with their delivery status', async () => {
    const { customer, order } = await seed()
    await db.notification_logs.add({
      id: 'log-1', order_id: order.id, customer_id: customer.id, channel: 'whatsapp', trigger: 'manual',
      recipient: '+96170123456', body: 'we printed an extra proof for you', status: 'sent', queued_at: '2026-01-01T10:00:00Z', sent_at: '2026-01-01T10:01:00Z',
    })
    await db.notification_logs.add({
      id: 'log-2', order_id: order.id, customer_id: customer.id, channel: 'whatsapp', trigger: 'manual',
      recipient: '+96170123456', body: 'could not reach the number', status: 'failed', error_message: 'invalid number', queued_at: '2026-01-01T09:00:00Z',
    })
    open(customer, order.id)
    expect(await screen.findByText('we printed an extra proof for you')).toBeTruthy()
    expect(screen.getByText('could not reach the number')).toBeTruthy()
    expect(screen.getByText('invalid number')).toBeTruthy()
    expect(screen.getAllByText(/WhatsApp/).length).toBeGreaterThan(0)
  })
})
