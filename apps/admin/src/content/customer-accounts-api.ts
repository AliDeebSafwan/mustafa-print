import { adminApi } from './call'

const { call } = adminApi('customer-accounts')

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

export const customerAccountsApi = {
  list: (q = '') => call<AccountRow[]>('GET', q ? `?q=${encodeURIComponent(q)}` : ''),
  detail: (id: string) => call<AccountDetail>('GET', `/${id}`),
  deactivate: (id: string) => call<unknown>('POST', `/${id}/deactivate`, {}),
  reactivate: (id: string) => call<unknown>('POST', `/${id}/reactivate`, {}),
  approve: (id: string) => call<unknown>('POST', `/${id}/approve`, {}),
  merge: (id: string, customerId: string) => call<{ orders_moved: number }>('POST', `/${id}/merge`, { customer_id: customerId }),
}
