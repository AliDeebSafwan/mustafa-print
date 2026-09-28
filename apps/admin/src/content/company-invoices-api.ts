import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

export interface UnbilledOrder { id: string; order_number: string | null; public_code: string; status: string; placed_at: string; currency: string; net: string; tax_total: string; total: string }
export interface CompanyInvoiceRow { id: string; invoice_number: string; currency: string; total: string; order_count: number; issued_at: string }
export interface CompanyInvoice extends CompanyInvoiceRow {
  subtotal: string; tax_total: string; customer_id: string; full_name: string; company_name: string | null; customer_tax_number: string | null
  address_line: string | null; city: string | null; legal_name_ar: string | null; legal_name_en: string | null; name_ar: string; name_en: string
  shop_tax_number: string | null; invoice_footer_ar: string | null; invoice_footer_en: string | null; vat_enabled: boolean; vat_rate_percent: string
  orders: { id: string; order_number: string | null; public_code: string; placed_at: string; net: string; tax_total: string; total: string }[]
}

/** Consolidated invoices are issued online: the number comes from the server's gap-free series. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/admin/company-invoices${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ContentError('offline') }
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
}

export const companyInvoicesApi = {
  unbilled: (customerId: string) => call<UnbilledOrder[]>('GET', `/unbilled?customer_id=${customerId}`),
  list: (customerId: string) => call<CompanyInvoiceRow[]>('GET', `?customer_id=${customerId}`),
  get: (id: string) => call<CompanyInvoice>('GET', `/${id}`),
  issue: (customerId: string, orderIds: string[]) => call<CompanyInvoice>('POST', '', { customer_id: customerId, order_ids: orderIds }),
}
