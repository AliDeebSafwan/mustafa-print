import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

export interface DashboardReport {
  rangeStart: string; rangeEnd: string
  ordersPlaced: number; revenuePlaced: string; ordersCompleted: number
  cashIn: string; cashOut: string; ordersDueToday: number
}
export interface UnpaidRow {
  id: string; public_code: string; order_number: string | null; placed_at: string; status: string; payment_status: string
  currency: string; total: string; paid_total: string; remaining: string; customer_name: string; customer_phone: string | null
}
export interface TillEntry {
  id: string; txn_type: string; method: string; amount: string; till_at: string; note: string | null
  public_code: string; order_number: string | null; customer_name: string; handled_by_name: string | null
}
export interface CashClosingReport {
  rangeStart: string; rangeEnd: string
  byMethod: { method: string; txn_type: string; amount: string; count: number }[]
  entries: TillEntry[]
}
export interface QueueRow {
  id: string; public_code: string; order_number: string | null; status: string; due_at: string | null; placed_at: string
  fulfillment_type: string; customer_name: string; customer_phone: string | null
}

const BASE = `${API_URL}/api/v1/admin/reports`
const KNOWN: ContentErrorCode[] = ['unauthorized', 'forbidden', 'not_found', 'invalid_request']

async function call<T>(path: string): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  } catch { throw new ContentError('offline') }
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ContentError(KNOWN.includes(payload?.error as ContentErrorCode) ? (payload!.error as ContentErrorCode) : 'server')
  }
  return (await res.json()) as T
}

const dateParam = (date?: string) => (date ? `?date=${date}` : '')

export const reportsApi = {
  dashboard: (date?: string) => call<DashboardReport>(`/dashboard${dateParam(date)}`),
  unpaid: () => call<UnpaidRow[]>('/unpaid'),
  cashClosing: (date?: string) => call<CashClosingReport>(`/cash-closing${dateParam(date)}`),
  productionQueue: () => call<QueueRow[]>('/production-queue'),
  /**
   * A CSV download needs the same bearer token as everything else here, so a plain link cannot carry it: this
   * fetches the file with the token and hands back a local URL the caller can click, exactly like a customer's
   * design file download.
   */
  async csvUrl(path: string): Promise<string> {
    const token = await auth.getAccessToken()
    if (!token) throw new ContentError('unauthorized')
    const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}format=csv`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new ContentError('server')
    return URL.createObjectURL(await res.blob())
  },
}
