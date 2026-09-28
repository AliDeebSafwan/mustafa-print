import { toCents, uuidv7, type DecimalInput } from '@mpe/shared'
import { db, type InventoryRow, type Row } from '../db'
import { buildPatch } from '../patch'
import { newMutation } from './mutation'

export interface InventoryItemInput {
  sku: string
  name_ar: string
  name_en: string
  category: string
  unit: string
  reorder_level?: string
  reorder_quantity?: string | null
  cost_per_unit?: string | null
  supplier_name?: string | null
}

/** Fields the store screen may change. The balance is not one of them: only movements move stock. */
export const EDITABLE_ITEM_FIELDS = [
  'name_ar', 'name_en', 'category', 'unit', 'reorder_level', 'reorder_quantity', 'cost_per_unit', 'supplier_name', 'is_active',
] as const

export async function createInventoryItem(input: InventoryItemInput): Promise<InventoryRow> {
  const id = uuidv7()
  const row: InventoryRow = {
    id, sku: input.sku.trim(), name_ar: input.name_ar.trim(), name_en: input.name_en.trim(),
    category: input.category, unit: input.unit, quantity_on_hand: '0', reorder_level: input.reorder_level ?? '0',
    reorder_quantity: input.reorder_quantity ?? null, cost_per_unit: input.cost_per_unit ?? null,
    supplier_name: input.supplier_name ?? null, is_active: true, _pending: true,
  }
  const mutation = newMutation('inventory_items:insert', id, {
    sku: row.sku, name_ar: row.name_ar, name_en: row.name_en, category: row.category as never, unit: row.unit as never,
    reorder_level: row.reorder_level, reorder_quantity: input.reorder_quantity ?? null, cost_per_unit: input.cost_per_unit ?? null,
    supplier_name: input.supplier_name ?? null,
  })
  await db.transaction('rw', db.inventory_items, db.outbox, async () => {
    await db.inventory_items.add(row)
    await db.outbox.add(mutation)
  })
  return row
}

export async function editInventoryItem(item: InventoryRow, next: Record<string, unknown>): Promise<boolean> {
  const patch = buildPatch(item as Row, next, EDITABLE_ITEM_FIELDS)
  if (!patch) return false
  const mutation = newMutation('inventory_items:update', item.id, patch as never, item.row_version ?? null)
  await db.transaction('rw', db.inventory_items, db.outbox, async () => {
    await db.inventory_items.update(item.id, { ...patch.changes, _pending: true })
    await db.outbox.add(mutation)
  })
  return true
}

export const MOVEMENT_TYPES = ['receipt', 'consumption', 'waste', 'return', 'adjustment', 'opening_balance'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

/** Movements that take stock out are written as a positive amount by the person and stored as a negative delta. */
const TAKES_OUT: readonly MovementType[] = ['consumption', 'waste']

export class InvalidMovementError extends Error {
  readonly reason: 'invalid_amount' | 'item_missing'
  constructor(reason: 'invalid_amount' | 'item_missing') {
    super(reason)
    this.name = 'InvalidMovementError'
    this.reason = reason
  }
}

export interface MovementInput {
  itemId: string
  type: MovementType
  /** Always positive as typed; the sign follows the kind of movement. An adjustment may be written with a minus. */
  amount: string
  unitCost?: string | null
  reason?: string
}

/**
 * Adds a line to the ledger. The balance is never written directly: the database derives it, so two devices
 * recording movements offline simply add up instead of overwriting each other.
 */
export async function recordMovement(input: MovementInput): Promise<void> {
  const item = await db.inventory_items.get(input.itemId)
  if (!item) throw new InvalidMovementError('item_missing')

  const typed = Number(input.amount)
  if (!Number.isFinite(typed) || typed === 0) throw new InvalidMovementError('invalid_amount')
  const signed = TAKES_OUT.includes(input.type) ? -Math.abs(typed) : input.type === 'adjustment' ? typed : Math.abs(typed)
  const delta = String(Number(signed.toFixed(3)))
  if (Number(delta) === 0) throw new InvalidMovementError('invalid_amount')

  const mutation = newMutation('stock_movements:stock_movement', uuidv7(), {
    item_id: input.itemId, movement_type: input.type, quantity_delta: delta,
    ...(input.unitCost ? { unit_cost: input.unitCost } : {}),
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    occurred_at: new Date().toISOString(),
  })
  await db.transaction('rw', db.inventory_items, db.outbox, async () => {
    // Optimistic balance; the server's answer replaces it on the next sync.
    const current = Number(item.quantity_on_hand ?? 0)
    await db.inventory_items.update(input.itemId, { quantity_on_hand: String(Number((current + Number(delta)).toFixed(3))), _pending: true })
    await db.outbox.add(mutation)
  })
}

export const isLowStock = (item: InventoryRow): boolean =>
  item.is_active !== false && Number(item.quantity_on_hand ?? 0) <= Number(item.reorder_level ?? 0)

/** The store, short items first so what needs ordering is the first thing seen. */
export async function listInventory(): Promise<InventoryRow[]> {
  const items = (await db.inventory_items.toArray()).filter((i) => !i.deleted_at)
  return items.sort((a, b) => Number(isLowStock(b)) - Number(isLowStock(a)) || a.name_ar.localeCompare(b.name_ar))
}

/** What this item has done lately, newest first. */
export const movementsFor = async (itemId: string, limit = 50): Promise<Row[]> =>
  (await db.stock_movements.filter((m) => m.item_id === itemId && !m.deleted_at).toArray())
    .sort((a, b) => String(b.occurred_at ?? '').localeCompare(String(a.occurred_at ?? '')))
    .slice(0, limit)

/** What a quantity of this product will take out of the store, from its recipe. */
export async function materialsFor(productId: string, quantity: DecimalInput = 1): Promise<{ item: InventoryRow; needed: number; shortfall: number }[]> {
  const lines = await db.product_materials.filter((m) => m.product_id === productId && !m.deleted_at).toArray()
  const out: { item: InventoryRow; needed: number; shortfall: number }[] = []
  for (const line of lines) {
    const item = await db.inventory_items.get(String(line.item_id))
    if (!item) continue
    const needed = Number(Number(quantity) * Number(line.quantity_per_unit) * (1 + Number(line.waste_pct ?? 0) / 100))
    out.push({ item, needed: Number(needed.toFixed(3)), shortfall: Math.max(0, needed - Number(item.quantity_on_hand ?? 0)) })
  }
  return out
}

export const stockValue = (items: InventoryRow[]): string => {
  const cents = items.reduce((sum, i) => sum + Math.round(Number(i.quantity_on_hand ?? 0) * ((toCents(String(i.cost_per_unit ?? '0')) ?? 0) / 100) * 100), 0)
  return (cents / 100).toFixed(2)
}

export interface RecipeLineInput { productId: string; itemId: string; quantityPerUnit: string; wastePct?: string; notes?: string }

/** Adds one material to a product's recipe. */
export async function addRecipeLine(input: RecipeLineInput): Promise<string> {
  const id = uuidv7()
  const mutation = newMutation('product_materials:insert', id, {
    product_id: input.productId, item_id: input.itemId, quantity_per_unit: input.quantityPerUnit,
    waste_pct: input.wastePct || '0', ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
  })
  await db.transaction('rw', db.product_materials, db.outbox, async () => {
    await db.product_materials.add({ id, product_id: input.productId, item_id: input.itemId, quantity_per_unit: input.quantityPerUnit, waste_pct: input.wastePct || '0', _pending: true })
    await db.outbox.add(mutation)
  })
  return id
}

/** Removes a material from a recipe. Past deductions are history and stay as they are. */
export async function removeRecipeLine(lineId: string): Promise<void> {
  const mutation = newMutation('product_materials:delete', lineId, {})
  await db.transaction('rw', db.product_materials, db.outbox, async () => {
    await db.product_materials.update(lineId, { deleted_at: new Date().toISOString(), _pending: true })
    await db.outbox.add(mutation)
  })
}

export const recipeFor = async (productId: string): Promise<Row[]> =>
  (await db.product_materials.filter((m) => m.product_id === productId && !m.deleted_at).toArray())
