import type { TemplateEditInput } from '@mpe/shared'
import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

export interface TemplateRow {
  id: string; row_version: number; template_key: string; channel: 'whatsapp' | 'sms' | 'email'; locale: 'ar' | 'en'
  subject: string | null; body: string; variables: string[]; provider_template_name: string | null; is_active: boolean
}

/** The owner's message editor: online only, like the website editor. */
async function call<T>(method: string, path: string, body?: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetchImpl(`${API_URL}/api/v1/admin/templates${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ContentError('offline') }
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
}

export const templatesApi = {
  list: () => call<TemplateRow[]>('GET', ''),
  save: (row: Pick<TemplateRow, 'id' | 'row_version'>, data: TemplateEditInput) => call<TemplateRow>('PUT', `/${row.id}`, { row_version: row.row_version, data }),
}
