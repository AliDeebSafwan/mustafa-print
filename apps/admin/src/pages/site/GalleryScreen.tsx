import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { MediaLibrary } from '../../components/site/MediaLibrary'
import { Picture } from '../../components/site/Picture'
import { ContentError, contentApi, type GalleryRow, type MediaRow, type ServiceRow } from '../../content'
import { useResource } from '../../content/use-resource'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

const asContentError = (err: unknown) => (err instanceof ContentError ? err : new ContentError('server'))

/** The showroom: work the shop has done, several pictures each, filed under a service. */
export function GalleryScreen() {
  const { t } = useTranslation()
  const load = useCallback(() => Promise.all([contentApi.gallery.list(), contentApi.services.list(), contentApi.media.list()]), [])
  const { data, error, reload } = useResource(load)
  const [editing, setEditing] = useState<GalleryRow | 'new' | null>(null)
  const [actionError, setActionError] = useState<ContentError | null>(null)
  const [items, services, media] = data ?? [[], [], []]
  const mediaById = new Map(media.map((m) => [m.id, m]))

  if (editing) {
    return <GalleryForm item={editing === 'new' ? null : editing} services={services} mediaById={mediaById} onDone={async () => { setEditing(null); await reload() }} />
  }

  async function toggle(item: GalleryRow) {
    setActionError(null)
    try { await contentApi.gallery.setStatus(item, item.status === 'published' ? 'draft' : 'published'); await reload() } catch (err) { setActionError(asContentError(err)) }
  }

  return (
    <div>
      <button type="button" className={`${primaryBtn} w-full`} onClick={() => setEditing('new')}>{t('site.gallery.new')}</button>
      <div className="mt-3"><ContentErrorMessage error={actionError ?? error} /></div>
      {data && items.length === 0 && <p className="mt-4 text-muted">{t('site.gallery.empty')}</p>}
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {items.map((item) => {
          const first = item.media_ids[0] ? mediaById.get(item.media_ids[0]) : undefined
          return (
            <li key={item.id} className="flex items-center gap-3 py-3">
              {first ? <Picture media={first} className="size-14 shrink-0 object-cover" sizes="56px" /> : <div className="size-14 shrink-0 bg-tint" />}
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setEditing(item)}>
                <p className="font-bold">{item.title_ar}</p>
                <p className="text-xs text-muted">{t('site.gallery.pictures', { count: item.media_ids.length })}</p>
              </button>
              <button type="button" className={`shrink-0 px-3 py-2 text-xs font-bold ${item.status === 'published' ? 'bg-ok text-white' : 'border border-ink'}`} onClick={() => void toggle(item)}>
                {item.status === 'published' ? t('site.published') : t('site.draft')}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GalleryForm({ item, services, mediaById, onDone }: { item: GalleryRow | null; services: ServiceRow[]; mediaById: Map<string, MediaRow>; onDone: () => Promise<void> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    title_ar: item?.title_ar ?? '', title_en: item?.title_en ?? '', description_ar: item?.description_ar ?? '', description_en: item?.description_en ?? '',
    service_id: item?.service_id ?? '', is_featured: item?.is_featured ?? false,
  })
  const [pictures, setPictures] = useState<string[]>(item?.media_ids ?? [])
  const [known, setKnown] = useState(mediaById)
  const [picking, setPicking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [error, setError] = useState<ContentError | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (field: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [field]: value }))

  if (picking) {
    return (
      <div>
        <button type="button" className={`${ghostBtn} mb-3 w-full`} onClick={() => setPicking(false)}>{t('site.gallery.donePicking')}</button>
        <MediaLibrary picked={pictures} onPick={(m) => { setKnown((k) => new Map(k).set(m.id, m)); setPictures((p) => [...p, m.id]) }} />
      </div>
    )
  }

  const move = (index: number, by: -1 | 1) => setPictures((p) => {
    const next = [...p]
    const [moved] = next.splice(index, 1)
    next.splice(index + by, 0, moved!)
    return next
  })

  async function save() {
    setError(null)
    setProblem(null)
    if (!form.title_ar.trim()) return setProblem(t('site.gallery.needTitle'))
    setBusy(true)
    try {
      const data = { ...form, service_id: form.service_id || null, media_ids: pictures }
      if (item) await contentApi.gallery.save(item, data)
      else await contentApi.gallery.create(data)
      await onDone()
    } catch (err) {
      setError(asContentError(err))
      setBusy(false)
    }
  }

  async function remove() {
    if (!item || !window.confirm(t('site.confirmDelete'))) return
    try { await contentApi.gallery.remove(item); await onDone() } catch (err) { setError(asContentError(err)) }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className={labelCls}>{t('site.titleAr')}<input className={inputCls} value={form.title_ar} onChange={(e) => set('title_ar', e.target.value)} /></label>
      <label className={labelCls}>{t('site.titleEn')}<input className={inputCls} dir="ltr" value={form.title_en} onChange={(e) => set('title_en', e.target.value)} /></label>
      <label className={labelCls}>{t('site.descriptionAr')}<textarea className={inputCls} rows={3} value={form.description_ar} onChange={(e) => set('description_ar', e.target.value)} /></label>
      <label className={labelCls}>{t('site.descriptionEn')}<textarea className={inputCls} dir="ltr" rows={3} value={form.description_en} onChange={(e) => set('description_en', e.target.value)} /></label>
      <label className={labelCls}>{t('site.gallery.service')}
        <select className={inputCls} value={form.service_id} onChange={(e) => set('service_id', e.target.value)}>
          <option value="">{t('site.gallery.noService')}</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.title_ar}</option>)}
        </select>
      </label>

      <div>
        <p className="text-sm font-semibold">{t('site.gallery.picturesTitle')}</p>
        {pictures.length === 0 && <p className="text-xs text-muted">{t('site.gallery.noPictures')}</p>}
        <ol className="mt-2 flex flex-col gap-2">
          {pictures.map((id, index) => {
            const media = known.get(id)
            return (
              <li key={id} className="flex items-center gap-2 border border-rule p-1.5">
                {media ? <Picture media={media} className="size-12 object-cover" sizes="48px" /> : <div className="size-12 bg-tint" />}
                <span className={`min-w-0 flex-1 truncate text-xs ${media?.alt_ar ? '' : 'font-bold text-magenta'}`}>{media?.alt_ar || t('site.media.needsDescription')}</span>
                <button type="button" className="border border-rule px-2 py-1 text-xs disabled:opacity-30" disabled={index === 0} aria-label={t('site.gallery.moveUp')} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className="border border-rule px-2 py-1 text-xs disabled:opacity-30" disabled={index === pictures.length - 1} aria-label={t('site.gallery.moveDown')} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="border border-rule px-2 py-1 text-xs text-magenta" aria-label={t('site.removePicture')} onClick={() => setPictures((p) => p.filter((x) => x !== id))}>✕</button>
              </li>
            )
          })}
        </ol>
        <button type="button" className={`${ghostBtn} mt-2 w-full`} onClick={() => setPicking(true)}>{t('site.gallery.addPictures')}</button>
      </div>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} />{t('site.featured')}</label>
      {problem && <p role="alert" className="text-sm font-semibold text-magenta">{problem}</p>}
      <ContentErrorMessage error={error} />
      <div className="flex gap-2">
        <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
        <button type="button" className={ghostBtn} onClick={() => void onDone()}>{t('common.cancel')}</button>
      </div>
      {item && <button type="button" className={`${ghostBtn} text-magenta`} onClick={() => void remove()}>{t('site.delete')}</button>}
    </div>
  )
}
