import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uuidv7 } from '@mpe/shared'
import { changeOrderStatus, createOrderLocally, findOrderByCode, InvalidTransitionError, parseScannedCode } from '../src/offline/actions'
import { db, getMeta } from '../src/offline/db'
import { pullChanges, pushOutbox, syncNow } from '../src/offline/sync'

const deps = (fetchImpl: typeof fetch) => ({ baseUrl: 'http://api.test', deviceId: 'device-12345678', fetchImpl })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('offline actions', () => {
  it('creating an order writes the order, its items and ONE outbox entry atomically', async () => {
    const order = await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'Cards', quantity: 3, unitPrice: 10.1 }] })
    expect(order.order_number).toBeNull()
    expect(order.total).toBe('30.30')
    expect(await db.order_items.count()).toBe(1)
    const [m] = await db.outbox.orderBy('clientCreatedAt').toArray()
    expect(m).toMatchObject({ entity: 'orders', op: 'insert', entityId: order.id })
    expect(await findOrderByCode(`https://x.example/ar/track/${order.public_code}`)).toMatchObject({ id: order.id })
  })

  it('status changes follow the shared state machine', async () => {
    const order = await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] })
    await expect(changeOrderStatus(order, 'delivered', { source: 'manual' })).rejects.toBeInstanceOf(InvalidTransitionError)
    expect(await db.outbox.count()).toBe(1)                       // still only the insert
    await changeOrderStatus(order, 'printing', { source: 'scanner', barcode: order.public_code })
    expect((await db.orders.get(order.id))?.status).toBe('printing')
    expect(await db.outbox.count()).toBe(2)
  })

  it('parses raw codes and tracking URLs, and rejects garbage', () => {
    expect(parseScannedCode(' k7m2q9x4tb3d ')).toBe('K7M2Q9X4TB3D')
    expect(parseScannedCode('https://print.example.com/en/track/K7M2Q9X4TB3D')).toBe('K7M2Q9X4TB3D')
    expect(parseScannedCode('hello world')).toBeNull()
  })
})

describe('push', () => {
  it('keeps the outbox when the network is down', async () => {
    await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] })
    const out = await pushOutbox(deps((async () => { throw new TypeError('offline') }) as typeof fetch))
    expect(out.status).toBe('offline')
    expect(await db.outbox.count()).toBe(1)
  })

  it('applies results: drops confirmed mutations and adopts the server row', async () => {
    const order = await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] })
    const [m] = await db.outbox.orderBy('clientCreatedAt').toArray()
    const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body))
      expect(sent.deviceId).toBe('device-12345678')
      expect(sent.mutations[0].id).toBe(m!.id)
      return json({ results: [{ id: m!.id, result: 'applied', row: { ...order, order_number: '1042', row_version: 1, _pending: false } }] })
    })
    const out = await pushOutbox(deps(fetchImpl as unknown as typeof fetch))
    expect(out).toMatchObject({ status: 'ok', applied: 1, conflicts: 0 })
    expect(await db.outbox.count()).toBe(0)
    expect(await db.orders.get(order.id)).toMatchObject({ order_number: '1042', _pending: false })
  })

  it('moves conflicts to the review queue and lets the server row win', async () => {
    const order = await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] })
    await db.outbox.clear()
    await changeOrderStatus(order, 'printing', { source: 'manual' })
    const [m] = await db.outbox.orderBy('clientCreatedAt').toArray()
    const fetchImpl = async () => json({ results: [{ id: m!.id, result: 'conflict', error: 'already ready', rowEntity: 'orders', row: { ...order, status: 'ready', row_version: 4 } }] })
    const out = await pushOutbox(deps(fetchImpl as unknown as typeof fetch))
    expect(out).toMatchObject({ applied: 0, conflicts: 1 })
    expect((await db.orders.get(order.id))?.status).toBe('ready')
    expect(await db.conflicts.toArray()).toMatchObject([{ id: m!.id, result: 'conflict', resolved: 0 }])
  })

  it('sends the access token and the device id, and reports a rejected session as unauthorized without losing anything', async () => {
    await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] })
    const seen: Record<string, string>[] = []
    const withToken = { ...deps((async (_u: unknown, init?: RequestInit) => { seen.push(init?.headers as Record<string, string>); return json({ error: 'invalid_token' }, 401) }) as unknown as typeof fetch), getToken: async () => 'tok-123' }
    expect((await pushOutbox(withToken)).status).toBe('unauthorized')
    expect(seen[0]).toMatchObject({ Authorization: 'Bearer tok-123' })
    expect(await db.outbox.count()).toBe(1)
  })

  it('stores a server row that belongs to a different table (the stock balance after a stock movement)', async () => {
    const [m] = [await (async () => { await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] }); return (await db.outbox.orderBy('clientCreatedAt').toArray())[0]! })()]
    const item = { id: 'i1', name_ar: 'ورق', name_en: 'Paper', sku: 'P', unit: 'sheet', quantity_on_hand: '70.000', reorder_level: '50' }
    const fetchImpl = async () => json({ results: [{ id: m.id, result: 'applied', rowEntity: 'inventory_items', row: item }] })
    expect(await pushOutbox(deps(fetchImpl as unknown as typeof fetch))).toMatchObject({ status: 'ok', applied: 1 })
    expect(await db.inventory_items.get('i1')).toMatchObject({ quantity_on_hand: '70.000' })
  })
})

describe('pull', () => {
  it('pages through changes, stores the cursor, deletes tombstones and skips rows with unsent local edits', async () => {
    const local = await createOrderLocally({ customerId: uuidv7(), items: [{ name: 'A', quantity: 1, unitPrice: 5 }] })
    await db.customers.put({ id: 'c-old' })
    const pages = [
      { changes: { customers: [{ id: 'c1', full_name: 'A' }, { id: 'c-old', deleted_at: '2026-01-01T00:00:00Z' }], orders: [{ ...local, status: 'ready' }] }, cursor: 'p1', hasMore: true },
      { changes: { inventory_items: [{ id: 'i1', name_ar: 'ورق', name_en: 'Paper', sku: 'P', unit: 'sheet', quantity_on_hand: '9', reorder_level: '10' }], unknown_table: [{ id: 'x' }] }, cursor: 'p2', hasMore: false },
    ]
    const seenCursors: (string | null)[] = []
    const fetchImpl = async (url: URL | string) => { seenCursors.push(new URL(String(url)).searchParams.get('cursor')); return json(pages.shift()) }
    const out = await pullChanges(deps(fetchImpl as unknown as typeof fetch))
    expect(out).toMatchObject({ status: 'ok' })
    expect(seenCursors).toEqual([null, 'p1'])
    expect(await getMeta('pullCursor')).toBe('p2')
    expect(await db.customers.get('c1')).toBeDefined()
    expect(await db.customers.get('c-old')).toBeUndefined()
    expect((await db.orders.get(local.id))?.status).toBe('received')     // local unsent order not overwritten
    expect(await db.inventory_items.count()).toBe(1)
  })

  it('syncNow pushes then pulls, and concurrent calls share one run', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: URL | string) => { calls.push(new URL(String(url)).pathname); return json({ changes: {}, cursor: 'c', hasMore: false }) }
    const [a, b] = await Promise.all([syncNow(deps(fetchImpl as unknown as typeof fetch)), syncNow(deps(fetchImpl as unknown as typeof fetch))])
    expect(a).toBe(b)
    expect(calls).toEqual(['/api/v1/sync/pull'])       // nothing to push -> only one pull
    expect(await getMeta('lastSync')).toMatchObject({ push: { status: 'idle' }, pull: { status: 'ok' } })
  })
})
