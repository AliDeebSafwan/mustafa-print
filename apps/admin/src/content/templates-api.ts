import type { TemplateEditInput } from '@mpe/shared'
import { adminApi } from './call'

const { call } = adminApi('templates')

export interface TemplateRow {
  id: string; row_version: number; template_key: string; channel: 'whatsapp' | 'sms' | 'email'; locale: 'ar' | 'en'
  subject: string | null; body: string; variables: string[]; provider_template_name: string | null; is_active: boolean
}

export const templatesApi = {
  list: () => call<TemplateRow[]>('GET', ''),
  save: (row: Pick<TemplateRow, 'id' | 'row_version'>, data: TemplateEditInput) => call<TemplateRow>('PUT', `/${row.id}`, { row_version: row.row_version, data }),
}
