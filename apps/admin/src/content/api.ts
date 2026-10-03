import type { ContentStatus, GalleryItemInput, ServiceInput, SiteSettingsInput } from '@mpe/shared'

/**
 * The owner's website editor talks to the server directly: this is office work done online, never queued offline.
 * Every call carries the signed-in session; every failure becomes a ContentError with a code the screens can explain.
 */
export type Row = Record<string, unknown> & { id: string; row_version: number }
export interface MediaRow extends Row { alt_ar: string | null; alt_en: string | null; width: number; height: number; srcset: { width: number; src: string }[] }
export interface ServiceRow extends Row { slug: string; title_ar: string; title_en: string | null; summary_ar: string | null; summary_en: string | null; body_ar: string | null; body_en: string | null; cover_media_id: string | null; status: ContentStatus; is_featured: boolean; sort_order: number }
export interface GalleryRow extends Row { title_ar: string; title_en: string | null; description_ar: string | null; description_en: string | null; service_id: string | null; media_ids: string[]; status: ContentStatus; is_featured: boolean; sort_order: number }
export type SettingsRow = Row & Record<string, unknown>

export type ContentErrorCode = 'offline' | 'unauthorized' | 'forbidden' | 'not_found' | 'version_conflict' | 'slug_taken' | 'media_in_use' | 'missing_alt_text' | 'invalid_image' | 'invalid_request' | 'server'
export class ContentError extends Error {
  readonly code: ContentErrorCode
  readonly detail?: string
  constructor(code: ContentErrorCode, detail?: string) { super(detail ?? code); this.name = 'ContentError'; this.code = code; this.detail = detail }
}

export interface ContentApiDeps { baseUrl: string; getToken: () => Promise<string | null>; fetchImpl?: typeof fetch }

/** The codes the screens have wording for (see `site.error.*` in i18n). Anything else is reported as `server`. */
export const KNOWN_ERROR_CODES: ContentErrorCode[] = ['unauthorized', 'forbidden', 'not_found', 'version_conflict', 'slug_taken', 'media_in_use', 'missing_alt_text', 'invalid_image', 'invalid_request']

export function createContentApi({ baseUrl, getToken, fetchImpl }: ContentApiDeps) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken()
    if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
    const isForm = body instanceof FormData
    let res: Response
    try {
      res = await (fetchImpl ?? fetch)(`${baseUrl}/api/v1/admin/content${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      })
    } catch {
      throw new ContentError('offline')
    }
    if (res.status === 204) return undefined as T
    const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    if (!res.ok) {
      const code = KNOWN_ERROR_CODES.includes(payload?.error as ContentErrorCode) ? (payload!.error as ContentErrorCode) : 'server'
      throw new ContentError(code, payload?.message)
    }
    return payload as T
  }

  const versionedCollection = <R extends Row, I>(path: string) => ({
    list: () => call<R[]>('GET', path),
    create: (data: I) => call<R>('POST', path, { data }),
    save: (row: Pick<R, 'id' | 'row_version'>, data: I) => call<R>('PUT', `${path}/${row.id}`, { row_version: row.row_version, data }),
    setStatus: (row: Pick<R, 'id' | 'row_version'>, status: ContentStatus) => call<R>('POST', `${path}/${row.id}/status`, { row_version: row.row_version, status }),
    remove: (row: Pick<R, 'id' | 'row_version'>) => call<void>('DELETE', `${path}/${row.id}?row_version=${row.row_version}`),
  })

  return {
    media: {
      list: () => call<MediaRow[]>('GET', '/media'),
      upload: (file: Blob, name: string) => { const form = new FormData(); form.append('file', file, name); return call<MediaRow>('POST', '/media', form) },
      describe: (id: string, alt: { alt_ar?: string | null; alt_en?: string | null }) => call<MediaRow>('PATCH', `/media/${id}`, alt),
      remove: (id: string) => call<void>('DELETE', `/media/${id}`),
    },
    services: versionedCollection<ServiceRow, ServiceInput>('/services'),
    gallery: versionedCollection<GalleryRow, GalleryItemInput>('/gallery'),
    settings: {
      get: () => call<SettingsRow>('GET', '/settings'),
      save: (row: Pick<SettingsRow, 'row_version'>, data: SiteSettingsInput) => call<SettingsRow>('PUT', '/settings', { row_version: row.row_version, data }),
    },
  }
}

export type ContentApi = ReturnType<typeof createContentApi>
