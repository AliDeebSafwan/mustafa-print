// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'receptionist', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null, depositPercent: 0, depositThreshold: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { EditOrderItemsPage } from '../../src/pages/EditOrderItemsPage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'receptionist'; session.depositPercent = 0; session.depositThreshold = null })

async function seed() {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Banner 2x1m', quantity: 1, unitPrice: 50 }] })
  await db.orders.update(order.id, { _pending: false })
  return order
}
const edit = (id: string) => renderAt(`/orders/${id}/edit-items`, [{ path: '/orders/:id/edit-items', element: <EditOrderItemsPage /> }])

describe('editing order items, not yet locked', () => {
  it('starts pre-filled with the order\'s current item, and saving replaces it', async () => {
    const order = await seed()
    const user = userEvent.setup()
    edit(order.id)
    const nameField = await screen.findByDisplayValue('Banner 2x1m')
    await user.clear(nameField)
    await user.type(nameField, 'Rollup banner')
    const priceFields = screen.getAllByLabelText('Unit price')
    await user.clear(priceFields[0]!)
    await user.type(priceFields[0]!, '75')
    await user.click(screen.getByRole('button', { name: 'Save order' }))

    expect(await screen.findByText('DETAIL PAGE')).toBeTruthy()
    const items = await db.order_items.where('order_id').equals(order.id).toArray()
    expect(items.filter((i) => !i.deleted_at)).toMatchObject([{ name_snapshot: 'Rollup banner', unit_price: '75' }])
    const saved = await db.orders.get(order.id)
    expect(saved).toMatchObject({ subtotal: '75.00', total: '75.00', _pending: true })
  })

  it('refuses to save an empty item list', async () => {
    const order = await seed()
    const user = userEvent.setup()
    edit(order.id)
    const nameField = await screen.findByDisplayValue('Banner 2x1m')
    await user.clear(nameField)
    await user.click(screen.getByRole('button', { name: 'Remove item' }))
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect((await db.order_items.where('order_id').equals(order.id).toArray()).some((i) => !i.deleted_at)).toBe(true)   // nothing was touched
  })
})

describe('once the order is locked', () => {
  it('a role without the override permission sees only that it is locked, with no editor', async () => {
    const order = await seed()
    await db.orders.update(order.id, { paid_total: '10' })
    edit(order.id)
    expect(await screen.findByText(/This order is locked/)).toBeTruthy()
    expect(screen.getByText('You do not have permission to edit a locked order\'s items.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save order' })).toBeNull()
  })

  it('the override permission shows the editor, but saving without a reason is refused', async () => {
    session.role = 'admin'
    const order = await seed()
    await db.orders.update(order.id, { paid_total: '10' })
    const user = userEvent.setup()
    edit(order.id)
    await screen.findByText(/This order is locked/)
    expect(screen.getByDisplayValue('Banner 2x1m')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByText('Write the reason for the edit')).toBeTruthy()

    await user.type(screen.getByPlaceholderText('Why is this order being edited after being locked?'), 'customer requested a size change')
    await user.click(screen.getByRole('button', { name: 'Save order' }))
    expect(await screen.findByText('DETAIL PAGE')).toBeTruthy()
  })
})
