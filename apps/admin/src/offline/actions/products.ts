import { unitPriceFor, uuidv7, type DecimalInput, type PriceTier } from '@mpe/shared'
import { db, type ProductRow } from '../db'
import { buildPatch } from '../patch'
import { newMutation } from './mutation'

export interface ProductInput {
  sku: string
  name_ar: string
  name_en: string
  category?: string
  unit?: string
  pricing_model?: 'fixed' | 'per_unit' | 'tiered'
  base_price?: string
  min_quantity?: string
  price_rules?: PriceTier[]
  is_active?: boolean
  is_public?: boolean
  description_ar?: string | null
  description_en?: string | null
  cover_media_id?: string | null
  service_id?: string | null
}

/** Fields the catalogue screen may change. `sku` is not here: a code other records point at should not move. */
export const EDITABLE_PRODUCT_FIELDS = [
  'name_ar', 'name_en', 'category', 'unit', 'pricing_model', 'base_price', 'min_quantity', 'price_rules', 'is_active', 'is_public', 'sort_order',
  'description_ar', 'description_en', 'cover_media_id', 'service_id',
] as const

export async function createProduct(input: ProductInput): Promise<ProductRow> {
  const id = uuidv7()
  const row: ProductRow = {
    id, sku: input.sku.trim(), name_ar: input.name_ar.trim(), name_en: input.name_en.trim(),
    category: input.category?.trim() || 'general', unit: input.unit ?? 'piece', pricing_model: input.pricing_model ?? 'per_unit',
    base_price: input.base_price ?? '0', min_quantity: input.min_quantity ?? '1', price_rules: input.price_rules ?? [],
    is_active: input.is_active ?? true, is_public: input.is_public ?? false,
    description_ar: input.description_ar?.trim() || null, description_en: input.description_en?.trim() || null,
    cover_media_id: input.cover_media_id ?? null, service_id: input.service_id ?? null, _pending: true,
  }
  const mutation = newMutation('products:insert', id, {
    sku: row.sku, name_ar: row.name_ar, name_en: row.name_en, category: row.category as string, unit: row.unit as never,
    pricing_model: row.pricing_model as never, base_price: row.base_price, min_quantity: row.min_quantity,
    price_rules: row.price_rules as PriceTier[], is_active: row.is_active as boolean, is_public: row.is_public as boolean,
    description_ar: row.description_ar as string | null, description_en: row.description_en as string | null,
    cover_media_id: row.cover_media_id as string | null, service_id: row.service_id as string | null,
  })
  await db.transaction('rw', db.products, db.outbox, async () => {
    await db.products.add(row)
    await db.outbox.add(mutation)
  })
  return row
}

/** Saves only the fields that changed; false when nothing did. */
export async function editProduct(product: ProductRow, next: Record<string, unknown>): Promise<boolean> {
  const patch = buildPatch(product, next, EDITABLE_PRODUCT_FIELDS)
  if (!patch) return false
  const mutation = newMutation('products:update', product.id, patch as never, product.row_version ?? null)
  await db.transaction('rw', db.products, db.outbox, async () => {
    await db.products.update(product.id, { ...patch.changes, _pending: true })
    await db.outbox.add(mutation)
  })
  return true
}

/** Retiring a product hides it from new orders; orders already taken keep the name and price they were given. */
export const setProductActive = (product: ProductRow, isActive: boolean): Promise<boolean> => editProduct(product, { is_active: isActive })

/** What one unit of this product costs at that quantity, tiers included. */
export const priceFor = (product: ProductRow, quantity: DecimalInput): string =>
  unitPriceFor({ pricing_model: product.pricing_model as string, base_price: product.base_price, price_rules: (product.price_rules ?? []) as PriceTier[] }, quantity)

export const listProducts = async (): Promise<ProductRow[]> =>
  (await db.products.filter((p) => !p.deleted_at).toArray()).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.name_ar.localeCompare(b.name_ar))
