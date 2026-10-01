import { adminCall } from './admin-call'

export interface UnbilledOrder { id: string; order_number: string | null; public_code: string; status: string; placed_at: string; currency: string; net: string; tax_total: string; total: string }
export interface CompanyInvoiceRow { id: string; invoice_number: string; currency: string; total: string; order_count: number; issued_at: string }
export interface CompanyInvoice extends CompanyInvoiceRow {
  subtotal: string; tax_total: string; customer_id: string; full_name: string; company_name: string | null; customer_tax_number: string | null
  address_line: string | null; city: string | null; legal_name_ar: string | null; legal_name_en: string | null; name_ar: string; name_en: string
  shop_tax_number: string | null; invoice_footer_ar: string | null; invoice_footer_en: string | null; vat_enabled: boolean; vat_rate_percent: string
  orders: { id: string; order_number: string | null; public_code: string; placed_at: string; net: string; tax_total: string; total: string }[]
}

/** Consolidated invoices are issued online: the number comes from the server's gap-free series. */
const call = adminCall('/api/v1/admin/company-invoices')

export const companyInvoicesApi = {
  unbilled: (customerId: string) => call<UnbilledOrder[]>('GET', `/unbilled?customer_id=${customerId}`),
  list: (customerId: string) => call<CompanyInvoiceRow[]>('GET', `?customer_id=${customerId}`),
  get: (id: string) => call<CompanyInvoice>('GET', `/${id}`),
  issue: (customerId: string, orderIds: string[]) => call<CompanyInvoice>('POST', '', { customer_id: customerId, order_ids: orderIds }),
}
