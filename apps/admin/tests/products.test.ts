import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { InvalidMutationError, createProduct, editProduct, listProducts, priceFor, setProductActive } from '../src/offline/actions'
import { db } from '../src/offline/db'

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })
const cards = () => createProduct({ sku: 'CARDS-500', name_ar: 'بطاقات', name_en: 'Business cards', base_price: '0.05', unit: 'sheet' })

describe('the catalogue', () => {
  it('adds a product and queues it once', async () => {
    const product = await cards()
    expect(product).toMatchObject({ sku: 'CARDS-500', base_price: '0.05', unit: 'sheet', is_active: true, is_public: false, _pending: true })
    const [m] = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(m).toMatchObject({ entity: 'products', op: 'insert', entityId: product.id })
    expect(m!.payload).toMatchObject({ sku: 'CARDS-500', name_en: 'Business cards', base_price: '0.05' })
  })

  it('refuses locally what the server would refuse: a bad code, an empty name, a negative price', async () => {
    await expect(createProduct({ sku: 'has spaces', name_ar: 'أ', name_en: 'A' })).rejects.toBeInstanceOf(InvalidMutationError)
    await expect(createProduct({ sku: 'OK', name_ar: '', name_en: 'A' })).rejects.toBeInstanceOf(InvalidMutationError)
    await expect(createProduct({ sku: 'OK', name_ar: 'أ', name_en: 'A', base_price: '-1' })).rejects.toBeInstanceOf(InvalidMutationError)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.products.count()).toBe(0)
  })

  it('saves only the fields that changed', async () => {
    const product = await cards()
    await db.outbox.clear()
    expect(await editProduct(product, { base_price: '0.06', name_ar: 'بطاقات' })).toBe(true)
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toEqual({ changes: { base_price: '0.06' }, base: { base_price: '0.05' } })
    expect(await editProduct((await db.products.get(product.id))!, { base_price: '0.06' })).toBe(false)
  })

  it('retires a product without touching anything else, and brings it back', async () => {
    const product = await cards()
    await db.outbox.clear()
    await setProductActive(product, false)
    expect((await db.products.get(product.id))!.is_active).toBe(false)
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toEqual({ changes: { is_active: false }, base: { is_active: true } })
    await setProductActive((await db.products.get(product.id))!, true)
    expect((await db.products.get(product.id))!.is_active).toBe(true)
  })

  it('quotes tier prices the same way the server does', async () => {
    const product = await createProduct({
      sku: 'FLYER', name_ar: 'منشور', name_en: 'Flyer', pricing_model: 'tiered', base_price: '0.08',
      price_rules: [{ min_quantity: '100', unit_price: '0.06' }, { min_quantity: '500', unit_price: '0.04' }],
    })
    expect([1, 100, 499, 500].map((q) => priceFor(product, q))).toEqual(['0.08', '0.06', '0.06', '0.04'])
  })

  it('lists by the order the shop chose, then by name, and hides deleted products', async () => {
    const a = await createProduct({ sku: 'B', name_ar: 'ب', name_en: 'B' })
    await createProduct({ sku: 'A', name_ar: 'أ', name_en: 'A' })
    const gone = await createProduct({ sku: 'C', name_ar: 'ج', name_en: 'C' })
    await db.products.update(gone.id, { deleted_at: '2026-01-01T00:00:00Z' })
    await db.products.update(a.id, { sort_order: -1 })
    expect((await listProducts()).map((p) => p.sku)).toEqual(['B', 'A'])
  })
})
