import { adminApi } from './call'

const { call, blobUrl } = adminApi('reports')

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

const dateParam = (date?: string) => (date ? `?date=${date}` : '')

export const reportsApi = {
  dashboard: (date?: string) => call<DashboardReport>('GET', `/dashboard${dateParam(date)}`),
  unpaid: () => call<UnpaidRow[]>('GET', '/unpaid'),
  cashClosing: (date?: string) => call<CashClosingReport>('GET', `/cash-closing${dateParam(date)}`),
  productionQueue: () => call<QueueRow[]>('GET', '/production-queue'),
  /**
   * A CSV download needs the same bearer token as everything else here, so a plain link cannot carry it: this
   * fetches the file with the token and hands back a local URL the caller can click, exactly like a customer's
   * design file download.
   */
  csvUrl: (path: string) => blobUrl(`${path}${path.includes('?') ? '&' : '?'}format=csv`),
}
