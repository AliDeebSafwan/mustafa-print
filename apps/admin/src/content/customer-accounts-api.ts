import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

export interface AccountRow {
  id: string; email: string; full_name: string; phone_e164: string | null; is_active: boolean; email_verified_at: string | null
  created_at: string; customer_id: string | null; customer_name: string | null; order_count: number
}
export interface AccountCandidate { id: string; full_name: string; phone_e164: string | null; email: string | null; order_count: number }
export interface AccountDetail extends Omit<AccountRow, 'order_count'> {
  locale: 'ar' | 'en'; customer_phone: string | null
  orders: { id: string; public_code: string; order_number: string | null; status: string; total: string; currency: string; placed_at: string }[]
  candidates: AccountCandidate[]
}

/** Website accounts, for the owner. Online only, like every other owner tool. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/admin/customer-accounts${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ContentError('offline') }
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
}

export const customerAccountsApi = {
  list: (q = '') => call<AccountRow[]>('GET', q ? `?q=${encodeURIComponent(q)}` : ''),
  detail: (id: string) => call<AccountDetail>('GET', `/${id}`),
  deactivate: (id: string) => call<unknown>('POST', `/${id}/deactivate`, {}),
  reactivate: (id: string) => call<unknown>('POST', `/${id}/reactivate`, {}),
  approve: (id: string) => call<unknown>('POST', `/${id}/approve`, {}),
  merge: (id: string, customerId: string) => call<{ orders_moved: number }>('POST', `/${id}/merge`, { customer_id: customerId }),
}
