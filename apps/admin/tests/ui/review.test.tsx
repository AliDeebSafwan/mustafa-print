// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'receptionist', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { ReviewPage } from '../../src/pages/ReviewPage'
import { createCustomerLocally, createOrderLocally, recordPaymentLocally } from '../../src/offline/actions'
import { db, type ConflictItem, type OutboxItem } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en') })
const open = () => renderAt('/review', [{ path: '/review', element: <ReviewPage /> }])
const fail = (mutation: OutboxItem, over: Partial<ConflictItem> = {}) =>
  db.conflicts.put({ id: mutation.id, mutation, result: 'rejected', error: 'forbidden: missing permission transactions:refund', createdAt: new Date().toISOString(), resolved: 0, ...over })

async function refusedRefund() {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: false })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Banner', quantity: 1, unitPrice: 50 }] })
  await db.orders.update(order.id, { order_number: '1042', paid_total: '50.00' })
  const txn = await recordPaymentLocally({ orderId: order.id, type: 'refund', method: 'cash', amount: '20' })
  const mutation = (await db.outbox.orderBy('clientCreatedAt').toArray()).find((m) => m.entityId === txn.id)!
  await db.outbox.clear()
  await fail(mutation)
  return { order, mutation }
}

describe('the review screen', () => {
  it('reassures when there is nothing to review', async () => {
    open()
    expect(await screen.findByText('Nothing to review. Every change reached the server.')).toBeTruthy()
  })

  it('explains in plain words what failed and why, and which order it was about', async () => {
    await refusedRefund()
    open()
    expect(await screen.findByText('Payment or refund')).toBeTruthy()
    expect(screen.getByText(/Refused by the server/)).toBeTruthy()
    expect(screen.getByText(/you do not have permission/)).toBeTruthy()
    expect(await screen.findByText(/#1042/)).toBeTruthy()   // the order line loads a moment after the entry
    expect(screen.getByText(/20\.00 USD/)).toBeTruthy()
  })

  it('retrying queues the work again and clears the entry', async () => {
    const { mutation } = await refusedRefund()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Nothing to review. Every change reached the server.')).toBeTruthy()
    const [queued] = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(queued!.entityId).toBe(mutation.entityId)
    expect(queued!.id).not.toBe(mutation.id)
  })

  it('dismissing clears the entry without sending anything', async () => {
    await refusedRefund()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByText(/Nothing to review/)).toBeTruthy()
    expect(await db.outbox.count()).toBe(0)
  })

  it('offers deleting the leftover copy of an order the server never created, and asks first', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170555111', whatsappOptIn: false })
    const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'x', quantity: 1, unitPrice: 5 }] })
    const mutation = (await db.outbox.orderBy('clientCreatedAt').toArray()).find((m) => m.entity === 'orders')!
    await db.outbox.clear()
    await db.orders.update(order.id, { _pending: false, _rejected: 'constraint_violation' })
    await fail(mutation, { error: 'constraint_violation: order_items_line_total_check' })

    const user = userEvent.setup()
    open()
    expect(await screen.findByText(/the order was never created on the server/)).toBeTruthy()

    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'Delete from device' }))
    expect(await db.orders.get(order.id)).toBeDefined()                       // the question was answered "no"

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Delete from device' }))
    await vi.waitFor(async () => expect(await db.orders.get(order.id)).toBeUndefined())
    expect(await db.order_items.where('order_id').equals(order.id).count()).toBe(0)
  })

  it('an edit offers no delete, since there is nothing orphaned to remove', async () => {
    const { customer } = await createCustomerLocally({ fullName: 'Rana', phone: '+96170555222', whatsappOptIn: false })
    await db.outbox.clear()
    const { newMutation } = await import('../../src/offline/actions')
    await fail(newMutation('customers:update', customer.id, { changes: { notes: 'mine' }, base: { notes: null } }), { result: 'conflict', error: 'changed on the server meanwhile: notes' })
    open()
    expect(await screen.findByText('Edit a customer')).toBeTruthy()
    expect(screen.getByText(/Changed on the server first/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete from device' })).toBeNull()
  })
})
