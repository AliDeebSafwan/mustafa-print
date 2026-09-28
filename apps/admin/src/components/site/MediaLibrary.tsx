import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentError, contentApi, type MediaRow } from '../../content'
import { useResource } from '../../content/use-resource'
import { ghostBtn, inputCls, primaryBtn } from '../../lib/ui'
import { ContentErrorMessage } from './ContentErrorMessage'
import { Picture } from './Picture'

/**
 * The shop's pictures. Used on its own to upload and describe, and as a picker inside the editors.
 * A picture must be described (in Arabic at least) before anything showing it can be published.
 */
export function MediaLibrary({ onPick, picked = [] }: { onPick?: (media: MediaRow) => void; picked?: string[] }) {
  const { t } = useTranslation()
  const load = useCallback(() => contentApi.media.list(), [])
  const { data, error, loading, reload } = useResource(load)
  const [actionError, setActionError] = useState<ContentError | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<MediaRow | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setActionError(null)
    try {
      for (const file of Array.from(files)) await contentApi.media.upload(file, file.name)
      await reload()
    } catch (err) {
      setActionError(err instanceof ContentError ? err : new ContentError('server'))
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function remove(media: MediaRow) {
    if (!window.confirm(t('site.media.confirmDelete'))) return
    setActionError(null)
    try { await contentApi.media.remove(media.id); await reload() } catch (err) { setActionError(err instanceof ContentError ? err : new ContentError('server')) }
  }

  if (editing) return <DescribeForm media={editing} onDone={async () => { setEditing(null); await reload() }} />

  return (
    <div>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label={t('site.media.upload')} onChange={(e) => void uploadFiles(e.target.files)} />
      <button type="button" className={`${primaryBtn} w-full`} disabled={busy} onClick={() => fileInput.current?.click()}>
        {busy ? t('site.media.uploading') : t('site.media.upload')}
      </button>
      <p className="mt-1 text-xs text-muted">{t('site.media.uploadHelp')}</p>
      <div className="mt-3"><ContentErrorMessage error={actionError ?? error} /></div>

      {loading && !data ? <p role="status" className="mt-4 text-muted">{t('login.loading')}</p> : data && data.length === 0 ? (
        <p className="mt-4 text-muted">{t('site.media.empty')}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data?.map((media) => {
            const chosen = picked.includes(media.id)
            return (
              <li key={media.id} className={`border p-1.5 ${chosen ? 'border-magenta' : 'border-rule'}`}>
                <Picture media={media} className="aspect-square w-full object-cover" />
                <p className={`mt-1 truncate text-xs ${media.alt_ar ? '' : 'font-bold text-magenta'}`}>{media.alt_ar || t('site.media.needsDescription')}</p>
                <div className="mt-1 flex gap-1">
                  {onPick ? (
                    <button type="button" className="flex-1 bg-ink px-2 py-1.5 text-xs font-bold text-white disabled:opacity-40" disabled={chosen} onClick={() => onPick(media)}>
                      {chosen ? t('site.media.chosen') : t('site.media.choose')}
                    </button>
                  ) : null}
                  <button type="button" className="flex-1 border border-ink px-2 py-1.5 text-xs font-semibold" onClick={() => setEditing(media)}>{t('site.media.describe')}</button>
                  {!onPick && <button type="button" className="border border-rule px-2 py-1.5 text-xs text-magenta" aria-label={t('site.media.delete')} onClick={() => void remove(media)}>✕</button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DescribeForm({ media, onDone }: { media: MediaRow; onDone: () => Promise<void> }) {
  const { t } = useTranslation()
  const [altAr, setAltAr] = useState(media.alt_ar ?? '')
  const [altEn, setAltEn] = useState(media.alt_en ?? '')
  const [error, setError] = useState<ContentError | null>(null)
  async function save() {
    try { await contentApi.media.describe(media.id, { alt_ar: altAr, alt_en: altEn }); await onDone() } catch (err) { setError(err instanceof ContentError ? err : new ContentError('server')) }
  }
  return (
    <div className="flex flex-col gap-3">
      <Picture media={media} className="max-h-72 w-full object-contain" sizes="600px" />
      <p className="text-sm text-muted">{t('site.media.describeHelp')}</p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('site.media.altAr')}<input className={inputCls} value={altAr} onChange={(e) => setAltAr(e.target.value)} /></label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('site.media.altEn')}<input className={inputCls} dir="ltr" value={altEn} onChange={(e) => setAltEn(e.target.value)} /></label>
      <ContentErrorMessage error={error} />
      <div className="flex gap-2">
        <button type="button" className={`${primaryBtn} flex-1`} onClick={() => void save()}>{t('common.save')}</button>
        <button type="button" className={ghostBtn} onClick={() => void onDone()}>{t('common.cancel')}</button>
      </div>
    </div>
  )
}
