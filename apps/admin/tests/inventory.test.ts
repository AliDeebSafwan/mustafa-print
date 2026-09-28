import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7 } from '@mpe/shared'
import {
  InvalidMovementError, InvalidMutationError, addRecipeLine, createInventoryItem, editInventoryItem, isLowStock,
  listInventory, materialsFor, movementsFor, recipeFor, recordMovement, removeRecipeLine, stockValue,
} from '../src/offline/actions'
import { db, type InventoryRow } from '../src/offline/db'

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

const paper = (over: Partial<Parameters<typeof createInventoryItem>[0]> = {}) =>
  createInventoryItem({ sku: 'PAPER-A4', name_ar: 'ورق', name_en: 'Paper A4', category: 'paper', unit: 'sheet', reorder_level: '500', ...over })

describe('keeping the store', () => {
  it('a new item starts at zero, because a balance is the ledger\'s to decide', async () => {
    const item = await paper()
    expect(item).toMatchObject({ sku: 'PAPER-A4', quantity_on_hand: '0', reorder_level: '500', is_active: true, _pending: true })
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).not.toHaveProperty('quantity_on_hand')
  })

  it('refuses locally what the server would refuse', async () => {
    await expect(createInventoryItem({ sku: 'has spaces', name_ar: 'و', name_en: 'P', category: 'paper', unit: 'sheet' })).rejects.toBeInstanceOf(InvalidMutationError)
    await expect(createInventoryItem({ sku: 'OK', name_ar: '', name_en: 'P', category: 'paper', unit: 'sheet' })).rejects.toBeInstanceOf(InvalidMutationError)
    expect(await db.outbox.count()).toBe(0)
  })

  it('an edit never carries the balance, even if the caller passes one', async () => {
    const item = await paper()
    await db.outbox.clear()
    expect(await editInventoryItem(item, { reorder_level: '900', quantity_on_hand: '9999' })).toBe(true)
    expect((await db.outbox.orderBy('clientCreatedAt').toArray())[0]!.payload).toEqual({ changes: { reorder_level: '900' }, base: { reorder_level: '500' } })
    expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('0')
  })

  it('puts what is running out first, and values the stock', async () => {
    const short = await paper({ sku: 'INK', name_ar: 'حبر', name_en: 'Ink', category: 'ink', unit: 'ml', reorder_level: '100' })
    const plenty = await paper({ sku: 'BOX', name_ar: 'علب', name_en: 'Boxes', category: 'packaging', unit: 'box', reorder_level: '0' })
    await db.inventory_items.update(plenty.id, { quantity_on_hand: '40', cost_per_unit: '0.25' })
    await db.inventory_items.update(short.id, { quantity_on_hand: '10', cost_per_unit: '0.10' })
    expect((await listInventory()).map((i) => i.sku)).toEqual(['INK', 'BOX'])
    expect(isLowStock((await db.inventory_items.get(short.id))!)).toBe(true)
    expect(stockValue(await listInventory())).toBe('11.00')          // 40 x 0.25 + 10 x 0.10
  })
})

describe('moving stock', () => {
  it('adds to the balance on a receipt and takes away on consumption, whatever sign was typed', async () => {
    const item = await paper()
    await recordMovement({ itemId: item.id, type: 'receipt', amount: '1000', unitCost: '0.012' })
    expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('1000')
    await recordMovement({ itemId: item.id, type: 'consumption', amount: '250' })
    expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('750')
    await recordMovement({ itemId: item.id, type: 'waste', amount: '-50' })       // typed with a minus by mistake
    expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('700')

    const queued = (await db.outbox.orderBy('clientCreatedAt').toArray()).filter((m) => m.entity === 'stock_movements')
    expect(queued.map((m) => m.payload.quantity_delta)).toEqual(['1000', '-250', '-50'])
    expect(queued[0]!.payload).toMatchObject({ movement_type: 'receipt', unit_cost: '0.012' })
  })

  it('a stock count may go either way', async () => {
    const item = await paper()
    await recordMovement({ itemId: item.id, type: 'receipt', amount: '100' })
    await recordMovement({ itemId: item.id, type: 'adjustment', amount: '-7', reason: 'count' })
    expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('93')
    await recordMovement({ itemId: item.id, type: 'adjustment', amount: '2' })
    expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('95')
  })

  it('refuses an empty, zero or unreal amount before anything is queued', async () => {
    const item = await paper()
    for (const amount of ['', '0', 'abc', '-0']) {
      await expect(recordMovement({ itemId: item.id, type: 'receipt', amount })).rejects.toBeInstanceOf(InvalidMovementError)
    }
    await expect(recordMovement({ itemId: uuidv7(), type: 'receipt', amount: '5' })).rejects.toMatchObject({ reason: 'item_missing' })
    expect(await db.outbox.count()).toBe(1)                                        // only the item insert
    expect((await db.inventory_items.get(item.id))!.quantity_on_hand).toBe('0')
  })

  it('lets the balance go negative rather than blocking the press, and says so', async () => {
    const item = await paper()
    await recordMovement({ itemId: item.id, type: 'consumption', amount: '80' })
    const stored = (await db.inventory_items.get(item.id))! as InventoryRow
    expect(Number(stored.quantity_on_hand)).toBe(-80)
    expect(isLowStock(stored)).toBe(true)
  })

  it('shows the item\'s history newest first', async () => {
    const item = await paper()
    await db.stock_movements.bulkPut([
      { id: uuidv7(), item_id: item.id, movement_type: 'receipt', quantity_delta: '100', occurred_at: '2026-09-01T10:00:00Z' },
      { id: uuidv7(), item_id: item.id, movement_type: 'consumption', quantity_delta: '-20', occurred_at: '2026-09-05T10:00:00Z' },
      { id: uuidv7(), item_id: uuidv7(), movement_type: 'receipt', quantity_delta: '5', occurred_at: '2026-09-06T10:00:00Z' },
    ])
    const history = await movementsFor(item.id)
    expect(history.map((m) => m.quantity_delta)).toEqual(['-20', '100'])
  })
})

describe('recipes', () => {
  it('records what a product eats and what a job of that size would need', async () => {
    const productId = uuidv7()
    const paperItem = await paper()
    const ink = await paper({ sku: 'INK', name_ar: 'حبر', name_en: 'Ink', category: 'ink', unit: 'ml', reorder_level: '0' })
    await db.inventory_items.update(paperItem.id, { quantity_on_hand: '1000' })
    await db.inventory_items.update(ink.id, { quantity_on_hand: '10' })

    await addRecipeLine({ productId, itemId: paperItem.id, quantityPerUnit: '1', wastePct: '5' })
    await addRecipeLine({ productId, itemId: ink.id, quantityPerUnit: '0.25' })
    expect(await recipeFor(productId)).toHaveLength(2)

    const needs = await materialsFor(productId, 1000)
    expect(needs.map((n) => [n.item.sku, n.needed, n.shortfall])).toEqual([
      ['PAPER-A4', 1050, 50],        // 1000 x 1 x 1.05, and the store is 50 short
      ['INK', 250, 240],
    ])
  })

  it('a removed line stops counting but its history stays', async () => {
    const productId = uuidv7()
    const item = await paper()
    const lineId = await addRecipeLine({ productId, itemId: item.id, quantityPerUnit: '2' })
    await removeRecipeLine(lineId)
    expect(await recipeFor(productId)).toEqual([])
    expect(await materialsFor(productId, 10)).toEqual([])
    expect((await db.outbox.orderBy('clientCreatedAt').toArray()).filter((m) => m.entity === 'product_materials').map((m) => m.op)).toEqual(['insert', 'delete'])
  })

  it('refuses a recipe line that could never work', async () => {
    await expect(addRecipeLine({ productId: uuidv7(), itemId: uuidv7(), quantityPerUnit: '0' })).rejects.toBeInstanceOf(InvalidMutationError)
    await expect(addRecipeLine({ productId: uuidv7(), itemId: uuidv7(), quantityPerUnit: 'abc' })).rejects.toBeInstanceOf(InvalidMutationError)
    expect(await db.outbox.count()).toBe(0)
  })
})
