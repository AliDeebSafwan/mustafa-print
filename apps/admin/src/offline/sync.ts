import { pullResponseSchema, pushResponseSchema, type Mutation } from '@mpe/shared'
import { DATA_TABLES, db, getMeta, isDataTable, setMeta, type OutboxItem, type Row } from './db'
import { adoptDuplicateCustomers, isMergedDuplicate, markRejected, requeueIfDependedOnMerge } from './reconcile'

export interface SyncDeps {
  baseUrl: string
  deviceId: string
  /** Resolves to a valid access token (refreshing it if needed), or null when signed out. */
  getToken?: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

export type PushStatus = 'idle' | 'ok' | 'offline' | 'unauthorized' | 'server_error'
export interface PushOutcome { status: PushStatus; applied: number; conflicts: number }
export interface PullOutcome { status: 'ok' | 'offline' | 'unauthorized' | 'server_error'; rows: number }

const headers = async (deps: SyncDeps): Promise<HeadersInit> => {
  const token = await deps.getToken?.()
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

const toWire = (m: OutboxItem): Mutation => ({
  id: m.id, entity: m.entity, entityId: m.entityId, op: m.op, baseVersion: m.baseVersion, payload: m.payload, clientCreatedAt: m.clientCreatedAt,
})

async function noteAttempt(items: OutboxItem[], error: string) {
  await db.transaction('rw', db.outbox, async () => {
    for (const it of items) await db.outbox.update(it.id, { attempts: it.attempts + 1, lastError: error })
  })
}

/** Send pending mutations (oldest first). Idempotent: the server answers "duplicate" for ids it has already seen. */
export async function pushOutbox(deps: SyncDeps): Promise<PushOutcome> {
  const pending = await db.outbox.orderBy('clientCreatedAt').limit(200).toArray()
  if (pending.length === 0) return { status: 'idle', applied: 0, conflicts: 0 }

  let res: Response
  try {
    res = await (deps.fetchImpl ?? fetch)(`${deps.baseUrl}/api/v1/sync/push`, {
      method: 'POST', headers: await headers(deps), body: JSON.stringify({ deviceId: deps.deviceId, mutations: pending.map(toWire) }),
    })
  } catch {
    return { status: 'offline', applied: 0, conflicts: 0 }
  }
  if (res.status === 401) return { status: 'unauthorized', applied: 0, conflicts: 0 }
  const parsed = res.ok ? pushResponseSchema.safeParse(await res.json().catch(() => null)) : null
  if (!parsed?.success) {
    await noteAttempt(pending, `HTTP ${res.status}`)
    return { status: 'server_error', applied: 0, conflicts: 0 }
  }

  let applied = 0
  let conflicts = 0
  const byId = new Map(pending.map((p) => [p.id, p]))
  await db.transaction('rw', [db.outbox, db.conflicts, ...DATA_TABLES.map((t) => db[t])], async () => {
    const merges = await adoptDuplicateCustomers(parsed.data.results, byId)     // before anything else, so later results see the corrected ids
    const requeued = new Set<string>()
    for (const r of parsed.data.results) {
      const mutation = byId.get(r.id)
      if (!mutation) continue

      if (isMergedDuplicate(mutation, merges)) {                                  // resolved automatically; keep a note for the audit trail
        await db.conflicts.put({ id: mutation.id, mutation, result: 'conflict', error: r.error, serverRow: r.row, createdAt: new Date().toISOString(), resolved: 1 })
        await db.outbox.delete(mutation.id)
        applied++
        continue
      }
      if (await requeueIfDependedOnMerge(mutation, r, merges, requeued)) continue

      const rowTable = r.rowEntity ?? mutation.entity
      if (r.row && isDataTable(rowTable)) await db.table(rowTable).put({ ...r.row, _pending: false })   // server truth wins
      if (r.result === 'applied' || r.result === 'duplicate') {
        applied++
      } else {
        conflicts++
        if (r.result === 'rejected') await markRejected(mutation, r.error ?? 'rejected')
        await db.conflicts.put({ id: mutation.id, mutation, result: r.result, error: r.error, serverRow: r.row, createdAt: new Date().toISOString(), resolved: 0 })
      }
      await db.outbox.delete(mutation.id)
    }
  })
  return { status: 'ok', applied, conflicts }
}

/** Ids touched by unsent local changes: a pulled row must not overwrite an optimistic edit that is still waiting. */
async function lockedIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const m of await db.outbox.toArray()) {
    ids.add(m.entityId)
    for (const k of ['order_id', 'item_id', 'customer_id']) if (typeof m.payload[k] === 'string') ids.add(m.payload[k] as string)
  }
  return ids
}

/** Pull everything changed since the stored cursor, page by page. Safe to repeat: rows are upserted by id. */
export async function pullChanges(deps: SyncDeps): Promise<PullOutcome> {
  let total = 0
  for (;;) {
    const cursor = await getMeta<string>('pullCursor')
    const url = new URL(`${deps.baseUrl}/api/v1/sync/pull`)
    if (cursor) url.searchParams.set('cursor', cursor)
    url.searchParams.set('limit', '200')

    let res: Response
    try {
      res = await (deps.fetchImpl ?? fetch)(url, { headers: await headers(deps) })
    } catch {
      return { status: 'offline', rows: total }
    }
    if (res.status === 401) return { status: 'unauthorized', rows: total }
    const parsed = res.ok ? pullResponseSchema.safeParse(await res.json().catch(() => null)) : null
    if (!parsed?.success) return { status: 'server_error', rows: total }

    const locked = await lockedIds()
    await db.transaction('rw', [db.meta, ...DATA_TABLES.map((t) => db[t])], async () => {
      for (const [entity, rows] of Object.entries(parsed.data.changes)) {
        if (!isDataTable(entity)) continue
        const table = db.table(entity)
        for (const row of rows as Row[]) {
          if (locked.has(row.id)) continue
          if (row.deleted_at) await table.delete(row.id)
          else await table.put(row)
          total++
        }
      }
      await setMeta('pullCursor', parsed.data.cursor)
    })
    if (!parsed.data.hasMore) return { status: 'ok', rows: total }
  }
}

const MAX_PUSH_ROUNDS = 10

/**
 * Keeps pushing until the outbox is empty. One round is not always enough: a batch is capped at 200 mutations, and
 * work that was re-queued after a duplicate customer was merged goes out in the next round.
 */
async function pushUntilDrained(deps: SyncDeps): Promise<PushOutcome> {
  let total: PushOutcome = { status: 'idle', applied: 0, conflicts: 0 }
  for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
    const outcome = await pushOutbox(deps)
    if (outcome.status === 'idle') break
    total = { status: outcome.status, applied: total.applied + outcome.applied, conflicts: total.conflicts + outcome.conflicts }
    if (outcome.status !== 'ok' || outcome.applied + outcome.conflicts === 0) break
  }
  return total
}

export interface SyncResult { push: PushOutcome; pull: PullOutcome; at: string }

let running: Promise<SyncResult> | null = null

/** Push first (so local intent reaches the server), then pull. Concurrent calls share one run. */
export function syncNow(deps: SyncDeps): Promise<SyncResult> {
  running ??= (async () => {
    try {
      const push = await pushUntilDrained(deps)
      const pull = push.status === 'offline' ? ({ status: 'offline', rows: 0 } as PullOutcome) : await pullChanges(deps)
      const result: SyncResult = { push, pull, at: new Date().toISOString() }
      await setMeta('lastSync', result)
      return result
    } finally {
      running = null
    }
  })()
  return running
}

/** Sync when the app opens, when connectivity returns, when the tab is focused again, and every 30 s. */
export function startAutoSync(deps: SyncDeps, intervalMs = 30_000): () => void {
  const run = () => { void syncNow(deps) }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(run, intervalMs)
  run()
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}
