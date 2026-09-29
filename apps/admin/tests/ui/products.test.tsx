// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const { ContentError } = await import('../../src/content/api')
  const pictures = [{ id: '018f0000-0000-7000-8000-0000000000aa', row_version: 1, alt_ar: 'ملصقات', alt_en: null, width: 800, height: 600, srcset: [{ width: 480, src: '/a-480.webp' }] }]
  const services = [{ id: '018f0000-0000-7000-8000-0000000000ee', title_ar: 'طباعة رقمية', title_en: 'Digital printing' }]
  return { ContentError, contentApi: { media: { list: async () => pictures }, services: { list: async () => services } } }
})

import { ProductsPage } from '../../src/pages/catalogue/ProductsPage'
import { createProduct } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); session.role = 'admin' })
const open = () => renderAt('/products', [{ path: '/products', element: <ProductsPage /> }])

describe('the products screen', () => {
  it('starts empty and adds the shop\'s first product', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('No products yet. Add the first one.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'New product' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the code and both names')

    await user.type(screen.getByLabelText(/Product code/), 'CARDS-500')
    await user.type(screen.getByLabelText('Name in Arabic'), 'بطاقات')
    await user.type(screen.getByLabelText('Name in English'), 'Business cards')
    await user.type(screen.getByLabelText(/Base price/), '0.05')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Business cards')).toBeTruthy()
    expect((await db.products.toArray())[0]).toMatchObject({ sku: 'CARDS-500', base_price: '0.05' })
    expect(await db.outbox.count()).toBe(1)
  })

  it('refuses a product code the server would reject', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: 'New product' }))
    await user.type(screen.getByLabelText(/Product code/), 'has spaces')
    await user.type(screen.getByLabelText('Name in Arabic'), 'أ')
    await user.type(screen.getByLabelText('Name in English'), 'A')
    await user.type(screen.getByLabelText(/Base price/), '1')          // everything else is fine: only the code is wrong
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid details. Check the fields.')
    expect(await db.products.count()).toBe(0)
  })

  it('adds quantity tiers only when the product is priced by them', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: 'New product' }))
    expect(screen.queryByText('Quantity prices')).toBeNull()

    await user.type(screen.getByLabelText(/Product code/), 'FLYER')
    await user.type(screen.getByLabelText('Name in Arabic'), 'منشور')
    await user.type(screen.getByLabelText('Name in English'), 'Flyer')
    await user.type(screen.getByLabelText(/Base price/), '0.08')
    await user.selectOptions(screen.getByLabelText('Pricing'), 'tiered')
    await user.click(await screen.findByRole('button', { name: 'Add a tier' }))
    await user.type(screen.getByLabelText('From quantity'), '500')
    await user.type(screen.getByLabelText('Unit price'), '0.04')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(async () => expect(await db.products.count()).toBe(1))
    expect((await db.products.toArray())[0]!.price_rules).toEqual([{ min_quantity: '500', unit_price: '0.04' }])
  })

  it('edits a price, keeps the code fixed, and retires without deleting', async () => {
    await createProduct({ sku: 'CARDS-500', name_ar: 'بطاقات', name_en: 'Business cards', base_price: '0.05' })
    await db.outbox.clear()
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Business cards/ }))
    expect((await screen.findByLabelText(/Product code/) as HTMLInputElement).disabled).toBe(true)

    await user.clear(screen.getByLabelText(/Base price/))
    await user.type(screen.getByLabelText(/Base price/), '0.06')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(async () => expect((await db.products.toArray())[0]!.base_price).toBe('0.06'))

    await user.click(await screen.findByRole('button', { name: /Business cards/ }))
    await user.click(screen.getByRole('button', { name: 'Retire the product' }))
    await vi.waitFor(async () => expect((await db.products.toArray())[0]!.is_active).toBe(false))
    expect(await db.products.count()).toBe(1)                     // retired, not deleted
    expect(await screen.findByText(/retired/)).toBeTruthy()
  })

  it('puts a product on the website with its description and picture, only for the owner', async () => {
    const user = userEvent.setup()
    const view = open()
    await user.click(await screen.findByRole('button', { name: 'New product' }))
    await user.type(screen.getByLabelText(/Product code/), 'STICKERS')
    await user.type(screen.getByLabelText('Name in Arabic'), 'ملصقات')
    await user.type(screen.getByLabelText('Name in English'), 'Stickers')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the base price (type 0 if it is priced on request)')
    await user.type(screen.getByLabelText(/Base price/), '0.5')
    await user.click(screen.getByLabelText('Show this product to customers on the website'))
    await user.type(screen.getByLabelText('Description in Arabic'), 'ملصقات بقص مخصص')
    await user.click(screen.getByRole('button', { name: 'Choose a picture' }))
    await user.click(await screen.findByRole('button', { name: 'Choose' }))
    expect(await screen.findByRole('button', { name: 'Change the picture' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(async () => expect(await db.products.count()).toBe(1))
    expect((await db.products.toArray())[0]).toMatchObject({ is_public: true, description_ar: 'ملصقات بقص مخصص', cover_media_id: '018f0000-0000-7000-8000-0000000000aa' })
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toMatchObject({ is_public: true, cover_media_id: '018f0000-0000-7000-8000-0000000000aa' })

    view.unmount()
    session.role = 'warehouse_manager'                 // may see products, may not decide what the website shows
    open()
    await user.click(await screen.findByRole('button', { name: /Stickers/ }).catch(() => screen.findByRole('button', { name: /ملصقات/ })))
    expect(screen.queryByText('On the website')).toBeNull()
  })

  it('links a product to a service page, and the choice reaches the queued mutation', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'New product' }))
    await user.type(screen.getByLabelText(/Product code/), 'FLYERS')
    await user.type(screen.getByLabelText('Name in Arabic'), 'منشورات')
    await user.type(screen.getByLabelText('Name in English'), 'Flyers')
    await user.type(screen.getByLabelText(/Base price/), '0.1')
    await user.selectOptions(await screen.findByLabelText(/^Linked service/), 'Digital printing')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(async () => expect(await db.products.count()).toBe(1))
    expect((await db.products.toArray())[0]).toMatchObject({ service_id: '018f0000-0000-7000-8000-0000000000ee' })
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toMatchObject({ service_id: '018f0000-0000-7000-8000-0000000000ee' })
  })
})
