import type { QuoteInput } from '@mpe/shared'
import { adminApi } from './call'

const { call } = adminApi('quotes')

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

export const quotesApi = {
  list: () => call<QuoteRow[]>('GET', ''),
  detail: (id: string) => call<QuoteDetail>('GET', `/${id}`),
  create: (input: QuoteInput) => call<QuoteDetail>('POST', '', input),
  cancel: (id: string) => call<QuoteDetail>('POST', `/${id}/cancel`, {}),
}
