import { uuidv7 } from '@mpe/shared'
import { db, type CompanyPriceOverrideRow } from '../db'
import { newMutation } from './mutation'

/** A company's agreed prices, newest first. Works offline: this is the device's own synced copy. */
export const listPriceOverrides = (customerId: string): Promise<CompanyPriceOverrideRow[]> =>
  db.company_price_overrides.where('customer_id').equals(customerId).filter((r) => !r.deleted_at).reverse().sortBy('id')

/** The price a product's override would show, or undefined if this company has none for it — used to suggest a
 *  price when adding that product to an order for them. */
export async function priceOverrideFor(customerId: string, productId: string): Promise<string | undefined> {
  const row = await db.company_price_overrides.where('customer_id').equals(customerId).filter((r) => r.product_id === productId && !r.deleted_at).first()
  return row?.unit_price
}

export class DuplicatePriceError extends Error { constructor() { super('duplicate_price'); this.name = 'DuplicatePriceError' } }

export async function addPriceOverride(customerId: string, productId: string, unitPrice: string): Promise<CompanyPriceOverrideRow> {
  const existing = await priceOverrideFor(customerId, productId)
  if (existing !== undefined) throw new DuplicatePriceError()

  const id = uuidv7()
  const row: CompanyPriceOverrideRow = { id, customer_id: customerId, product_id: productId, unit_price: unitPrice, _pending: true }
  const mutation = newMutation('company_price_overrides:insert', id, { customer_id: customerId, product_id: productId, unit_price: unitPrice })
  await db.transaction('rw', db.company_price_overrides, db.outbox, async () => {
    await db.company_price_overrides.add(row)
    await db.outbox.add(mutation)
  })
  return row
}

export async function editPriceOverride(override: CompanyPriceOverrideRow, unitPrice: string): Promise<void> {
  if (unitPrice === override.unit_price) return
  const mutation = newMutation('company_price_overrides:update', override.id, { unit_price: unitPrice, base: { unit_price: override.unit_price } }, override.row_version ?? null)
  await db.transaction('rw', db.company_price_overrides, db.outbox, async () => {
    await db.company_price_overrides.update(override.id, { unit_price: unitPrice, _pending: true })
    await db.outbox.add(mutation)
  })
}

export async function removePriceOverride(override: CompanyPriceOverrideRow): Promise<void> {
  const mutation = newMutation('company_price_overrides:delete', override.id, {}, override.row_version ?? null)
  await db.transaction('rw', db.company_price_overrides, db.outbox, async () => {
    await db.company_price_overrides.update(override.id, { deleted_at: new Date().toISOString(), _pending: true })
    await db.outbox.add(mutation)
  })
}
