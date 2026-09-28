import type { BranchSettingsInput, StaffCreateInput, StaffUpdateInput } from '@mpe/shared'
import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

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

/** The owner's tools for the team and the shop's business rules: online only, like the website editor. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/admin/team${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ContentError('offline') }
  if (res.status === 204) return undefined as T
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
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
