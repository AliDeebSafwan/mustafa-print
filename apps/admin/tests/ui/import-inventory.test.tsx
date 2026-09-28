// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { ImportInventoryPage } from '../../src/pages/ImportInventoryPage'
import { createInventoryItem } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  session.role = 'admin'
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
const open = () => renderAt('/inventory/import', [{ path: '/inventory/import', element: <ImportInventoryPage /> }])
const csv = (text: string) => new File([text], 'inventory.csv', { type: 'text/csv' })
const upload = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.upload(screen.getByLabelText('Choose CSV file'), csv(text))
}

describe('importing inventory from a file', () => {
  it('creates new items with an opening balance, updates an existing one without re-adding stock', async () => {
    await createInventoryItem({ sku: 'PAPER-A4-80', name_ar: 'ورق قديم', name_en: 'Old paper', category: 'paper', unit: 'ream' })
    await db.outbox.clear()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Download blank template' }))   // does not throw
    await screen.findByRole('button', { name: 'Download my current inventory (to edit)' })   // confirms the existing item has loaded

    await upload(user, [
      'sku,name_ar,name_en,category,unit,reorder_level,reorder_quantity,cost_per_unit,supplier_name,opening_balance',
      'PAPER-A4-80,ورق A4,A4 paper,paper,ream,10,20,3.5,,50',
      'INK-K,حبر أسود,Black ink,ink,liter,2,,,,5',
    ].join('\n'))
    await screen.findByText('Every row is valid: 2 product(s) ready to import.')
    expect(screen.getByText('Updates an existing product')).toBeTruthy()
    expect(screen.getByText(/New product/)).toBeTruthy()
    expect(screen.getByText(/Opening balance: 5$/)).toBeTruthy()             // shown only for the brand-new item
    expect(screen.queryByText(/Opening balance: 50/)).toBeNull()            // not for the one that already existed

    await user.click(screen.getByRole('button', { name: 'Import 2 product(s)' }))
    expect(await screen.findByText('Done: 1 new, 1 updated, 1 with an opening balance. Sent once online.')).toBeTruthy()

    const paper = await db.inventory_items.where('sku').equals('PAPER-A4-80').first()
    expect(paper).toMatchObject({ name_ar: 'ورق A4', quantity_on_hand: '0' })   // updated, but its balance is untouched by the file's opening_balance column
    const ink = await db.inventory_items.where('sku').equals('INK-K').first()
    expect(ink).toMatchObject({ name_ar: 'حبر أسود', quantity_on_hand: '5' })   // brand new: the opening balance was applied
    const queued = await db.outbox.orderBy('clientCreatedAt').toArray()
    const openingMutation = queued.find((m) => m.op === 'stock_movement')
    expect(openingMutation?.payload).toMatchObject({ item_id: ink!.id, movement_type: 'opening_balance', quantity_delta: '5' })
  })

  it('a blank reorder level on an update leaves the existing one alone', async () => {
    await createInventoryItem({ sku: 'PAPER-A4-80', name_ar: 'ورق', name_en: 'Paper', category: 'paper', unit: 'ream', reorder_level: '15' })
    const user = userEvent.setup()
    open()
    await screen.findByRole('button', { name: 'Download my current inventory (to edit)' })
    await upload(user, ['sku,name_ar,name_en,category,unit', 'PAPER-A4-80,ورق جديد,New paper,paper,ream'].join('\n'))
    await screen.findByText('Every row is valid: 1 product(s) ready to import.')
    await user.click(screen.getByRole('button', { name: 'Import 1 product(s)' }))
    await screen.findByText(/Done:/)

    const row = await db.inventory_items.where('sku').equals('PAPER-A4-80').first()
    expect(row).toMatchObject({ name_ar: 'ورق جديد', reorder_level: '15' })
  })

  it('rejects an unknown category or unit, and an invalid opening balance', async () => {
    const user = userEvent.setup()
    open()
    await upload(user, [
      'sku,name_ar,name_en,category,unit,opening_balance',
      'X-1,مادة,Item,not_a_category,ream,10',
      'X-2,مادة,Item,paper,not_a_unit,10',
      'X-3,مادة,Item,paper,ream,-5',
    ].join('\n'))
    expect(await screen.findByText('0 valid row(s), and 3 row(s) with an error (won\'t be imported until you fix it in the file and upload again).')).toBeTruthy()
    expect(screen.getByText(/Unknown inventory category/)).toBeTruthy()
    expect(screen.getByText(/Unknown unit/)).toBeTruthy()
    expect(screen.getByText(/Invalid opening balance/)).toBeTruthy()
  })

  it('is refused to a role without inventory:manage, silently — no upload control at all', async () => {
    session.role = 'staff'
    open()
    await screen.findByText('Import inventory from a file')
    expect(screen.queryByLabelText('Choose CSV file')).toBeNull()
  })
})
