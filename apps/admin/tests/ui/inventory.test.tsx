// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'warehouse_manager', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { InventoryPage } from '../../src/pages/InventoryPage'
import { createInventoryItem } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'warehouse_manager' })
const open = () => renderAt('/inventory', [{ path: '/inventory', element: <InventoryPage /> }])
const paper = () => createInventoryItem({ sku: 'PAPER-A4', name_ar: 'ورق', name_en: 'Paper A4', category: 'paper', unit: 'sheet', reorder_level: '500' })

describe('the store screen', () => {
  it('adds the first item and shows it at zero', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('No items yet.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'New item' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the code and both names')

    await user.type(screen.getByLabelText('Item code'), 'PAPER-A4')
    await user.type(screen.getByLabelText('Name in Arabic'), 'ورق')
    await user.type(screen.getByLabelText('Name in English'), 'Paper A4')
    await user.type(screen.getByLabelText('Reorder level'), '500')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Paper A4')).toBeTruthy()
    expect((await db.inventory_items.toArray())[0]).toMatchObject({ sku: 'PAPER-A4', quantity_on_hand: '0' })
    expect(screen.getByText('Low')).toBeTruthy()                        // zero is below the reorder level
  })

  it('records a receipt and a consumption, and the balance follows', async () => {
    const item = await paper()
    await db.outbox.clear()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Paper A4/ }))

    await user.selectOptions(await screen.findByLabelText('Kind of movement'), 'receipt')
    await user.type(screen.getByLabelText(/Amount/), '1000')
    await user.click(screen.getByRole('button', { name: 'Record the movement' }))
    expect(await screen.findByText('Recorded. It will be sent when you are online.')).toBeTruthy()
    await vi.waitFor(async () => expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('1000'))

    await user.selectOptions(screen.getByLabelText('Kind of movement'), 'consumption')
    await user.type(screen.getByLabelText(/Amount/), '250')
    await user.click(screen.getByRole('button', { name: 'Record the movement' }))
    await vi.waitFor(async () => expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('750'))
    expect((await db.outbox.orderBy('clientCreatedAt').toArray()).filter((m) => m.entity === 'stock_movements')).toHaveLength(2)
  })

  it('refuses a movement of nothing', async () => {
    await paper()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Paper A4/ }))
    await user.type(await screen.findByLabelText(/Amount/), '0')
    await user.click(screen.getByRole('button', { name: 'Record the movement' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a valid amount other than zero')
    expect(await db.outbox.count()).toBe(1)                              // only the item insert
  })

  it('warns when the store owes more than it holds', async () => {
    const item = await paper()
    await db.inventory_items.update(item.id, { quantity_on_hand: '-40' })
    open()
    expect(await screen.findByText('negative')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Paper A4/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('more was consumed than was recorded')
  })

  it('shows an operator only the movements they may make, and never the item form', async () => {
    await paper()
    session.role = 'machine_operator'
    const user = userEvent.setup()
    open()
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: /Paper A4/ }))
    const kinds = [...((await screen.findByLabelText('Kind of movement')) as HTMLSelectElement).options].map((o) => o.value)
    expect(kinds).toEqual(['consumption', 'waste'])                      // may use stock, may not receive or count it
    expect(screen.queryByRole('button', { name: 'Edit item' })).toBeNull()
  })
})
