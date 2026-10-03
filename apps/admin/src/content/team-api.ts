import type { BranchSettingsInput, StaffCreateInput, StaffUpdateInput } from '@mpe/shared'
import { adminApi } from './call'

const { call } = adminApi('team')

export interface StaffRow {
  id: string; row_version: number; full_name: string; email: string | null; phone_e164: string | null
  locale: 'ar' | 'en'; is_active: boolean; role_key: 'admin' | 'staff'; granted_permissions: string[]
  permissions: readonly string[]; last_login_at: string | null; created_at: string
}
export interface AuditEntry {
  id: string; action: string; target_type: string | null; target_id: string | null
  details: Record<string, unknown>; created_at: string; actor_name: string | null
}
export interface BranchSettingsRow {
  id: string; max_discount_percent: string | null; row_version: number
  legal_name_ar: string | null; legal_name_en: string | null; tax_number: string | null
  vat_enabled: boolean; vat_rate_percent: string; invoice_footer_ar: string | null; invoice_footer_en: string | null
  deposit_percent: string; deposit_threshold: string | null
  summary_email: string | null; summary_hour: number
}

export const teamApi = {
  list: () => call<StaffRow[]>('GET', '/users'),
  create: (data: StaffCreateInput) => call<StaffRow>('POST', '/users', data),
  save: (row: Pick<StaffRow, 'id' | 'row_version'>, data: StaffUpdateInput) => call<StaffRow>('PUT', `/users/${row.id}`, { row_version: row.row_version, data }),
  resetPassword: (id: string, password: string) => call<void>('POST', `/users/${id}/reset-password`, { password }),
  endSessions: (id: string) => call<void>('POST', `/users/${id}/end-sessions`),
  auditLog: (opts: { before?: string; limit?: number } = {}) =>
    call<AuditEntry[]>('GET', `/audit-log?${new URLSearchParams({ ...(opts.before ? { before: opts.before } : {}), ...(opts.limit ? { limit: String(opts.limit) } : {}) })}`),
  branchSettings: {
    get: () => call<BranchSettingsRow>('GET', '/branch-settings'),
    save: (row: Pick<BranchSettingsRow, 'row_version'>, data: BranchSettingsInput) => call<BranchSettingsRow>('PUT', '/branch-settings', { row_version: row.row_version, data }),
  },
}
