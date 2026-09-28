import type { QuoteInput } from '@mpe/shared'
import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

export interface QuoteRow {
  id: string; quote_number: string; public_code: string; status: 'sent' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  total: string; currency: string; valid_until: string; created_at: string; customer_name: string
}
export interface QuoteDetail extends QuoteRow {
  subtotal: string; discount_total: string; tax_total: string; notes: string | null; internal_notes: string | null
  decline_reason: string | null; order_id: string | null; accepted_at: string | null; customer_id: string; customer_phone: string | null
  items: { name: string; quantity: string; unit_price: string; discount: string; line_total: string; notes: string | null }[]
  link: string
}

/** Quotes are issued online, like invoices: office work, not the shop floor. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/admin/quotes${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ContentError('offline') }
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
}

export const quotesApi = {
  list: () => call<QuoteRow[]>('GET', ''),
  detail: (id: string) => call<QuoteDetail>('GET', `/${id}`),
  create: (input: QuoteInput) => call<QuoteDetail>('POST', '', input),
  cancel: (id: string) => call<QuoteDetail>('POST', `/${id}/cancel`, {}),
}
