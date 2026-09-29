// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))

import { ImportProductsPage } from '../../src/pages/catalogue/ImportProductsPage'
import { createProduct } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  session.role = 'admin'
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:mock') })
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
const open = () => renderAt('/products/import', [{ path: '/products/import', element: <ImportProductsPage /> }])
const csv = (text: string) => new File([text], 'products.csv', { type: 'text/csv' })
const upload = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.upload(screen.getByLabelText('Choose CSV file'), csv(text))
}

describe('importing products from a file', () => {
  it('offers a template and, once products exist, the current list', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByRole('button', { name: 'Download blank template' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download my current products (to edit)' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Download blank template' }))   // does not throw
    expect(window.URL.createObjectURL).toHaveBeenCalled()
  })

  it('validates every row, keeps valid ones importable, and rejects the rest with a reason', async () => {
    const user = userEvent.setup()
    open()
    await upload(user, [
      'sku,name_ar,name_en,category,unit,pricing_model,base_price,min_quantity,is_active,is_public,description_ar,description_en',
      'FLY-A5,منشورات,Flyers,,sheet,per_unit,0.08,100,نعم,نعم,,',
      ',بلا رمز,No SKU,,piece,per_unit,1,1,نعم,نعم,,',
      'BC-1,بطاقات,Cards,,piece,not_a_model,-5,0,maybe,نعم,,',
    ].join('\n'))

    expect(await screen.findByText('1 valid row(s), and 2 row(s) with an error (won\'t be imported until you fix it in the file and upload again).')).toBeTruthy()
    expect(screen.getByText('New product')).toBeTruthy()
    expect(screen.getByText(/SKU is missing/)).toBeTruthy()
    expect(screen.getByText(/Unknown pricing model/)).toBeTruthy()
    expect(screen.getByText(/Invalid price/)).toBeTruthy()
    expect(screen.getByText(/Invalid minimum quantity/)).toBeTruthy()
    expect(screen.getByText(/Write yes or no/)).toBeTruthy()
  })

  it('flags a SKU repeated within the same file, without touching the database', async () => {
    const user = userEvent.setup()
    open()
    await upload(user, [
      'sku,name_ar,name_en,unit,pricing_model,base_price,min_quantity,is_active,is_public',
      'FLY-A5,منشورات,Flyers,sheet,per_unit,0.08,100,نعم,نعم',
      'FLY-A5,منشورات ثانية,Flyers again,sheet,per_unit,0.10,100,نعم,نعم',
    ].join('\n'))
    expect(await screen.findByText(/This SKU repeats in the same file/)).toBeTruthy()
    expect(await db.products.count()).toBe(0)
  })

  it('imports the valid rows, creating new products and updating an existing one by SKU', async () => {
    await createProduct({ sku: 'BC-1', name_ar: 'قديم', name_en: 'Old name', base_price: '5' })
    await db.outbox.clear()
    const user = userEvent.setup()
    open()
    await screen.findByRole('button', { name: 'Download my current products (to edit)' })   // confirms the existing product has loaded
    await upload(user, [
      'sku,name_ar,name_en,unit,pricing_model,base_price,min_quantity,is_active,is_public',
      'FLY-A5,منشورات,Flyers,sheet,per_unit,0.08,100,نعم,نعم',
      'BC-1,اسم جديد,New name,piece,fixed,9.5,1,نعم,لا',
    ].join('\n'))
    await screen.findByText('Every row is valid: 2 product(s) ready to import.')
    expect(screen.getByText('New product')).toBeTruthy()
    expect(screen.getByText('Updates an existing product')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Import 2 product(s)' }))
    expect(await screen.findByText('Done: 1 new, 1 updated. Sent once online.')).toBeTruthy()

    const created = await db.products.where('sku').equals('FLY-A5').first()
    expect(created).toMatchObject({ name_ar: 'منشورات', base_price: '0.08', is_public: true })
    const updated = await db.products.where('sku').equals('BC-1').first()
    expect(updated).toMatchObject({ name_ar: 'اسم جديد', name_en: 'New name', base_price: '9.5', is_public: false })
    expect(await db.outbox.count()).toBe(2)
  })

  it('a blank cell on an update leaves that field as it was, never clears it', async () => {
    await createProduct({ sku: 'BC-1', name_ar: 'قديم', name_en: 'Old', base_price: '5', category: 'خاص', description_ar: 'وصف موجود', is_public: true })
    await db.outbox.clear()
    const user = userEvent.setup()
    open()
    await screen.findByRole('button', { name: 'Download my current products (to edit)' })
    // only the price changes; category, description and is_public are left blank in the file
    await upload(user, ['sku,name_ar,name_en,unit,pricing_model,base_price,min_quantity', 'BC-1,قديم,Old,piece,fixed,7,1'].join('\n'))
    await screen.findByText('Every row is valid: 1 product(s) ready to import.')
    await user.click(screen.getByRole('button', { name: 'Import 1 product(s)' }))
    await screen.findByText('Done: 0 new, 1 updated. Sent once online.')

    const row = await db.products.where('sku').equals('BC-1').first()
    expect(row).toMatchObject({ base_price: '7', category: 'خاص', description_ar: 'وصف موجود', is_public: true })
  })

  it('is refused to a role without products:write, silently — no upload control at all', async () => {
    session.role = 'staff'
    open()
    await screen.findByText('Import products from a file')
    expect(screen.queryByLabelText('Choose CSV file')).toBeNull()
  })
})
