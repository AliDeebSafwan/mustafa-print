import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SLUG_RE } from '@mpe/shared'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { MediaLibrary } from '../../components/site/MediaLibrary'
import { Picture } from '../../components/site/Picture'
import { ContentError, contentApi, type MediaRow, type ServiceRow } from '../../content'
import { useResource } from '../../content/use-resource'
import { slugify } from '../../lib/slug'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

const asContentError = (err: unknown) => (err instanceof ContentError ? err : new ContentError('server'))

/** What the shop does, one page per service on the website. */
export function ServicesScreen() {
  const { t } = useTranslation()
  const load = useCallback(() => Promise.all([contentApi.services.list(), contentApi.media.list()]), [])
  const { data, error, reload } = useResource(load)
  const [editing, setEditing] = useState<ServiceRow | 'new' | null>(null)
  const [actionError, setActionError] = useState<ContentError | null>(null)

  if (editing) {
    return <ServiceForm service={editing === 'new' ? null : editing} onDone={async () => { setEditing(null); await reload() }} />
  }
  const [services, media] = data ?? [[], []]
  const mediaById = new Map(media.map((m) => [m.id, m]))

  async function toggle(service: ServiceRow) {
    setActionError(null)
    try { await contentApi.services.setStatus(service, service.status === 'published' ? 'draft' : 'published'); await reload() } catch (err) { setActionError(asContentError(err)) }
  }

  return (
    <div>
      <button type="button" className={`${primaryBtn} w-full`} onClick={() => setEditing('new')}>{t('site.services.new')}</button>
      <div className="mt-3"><ContentErrorMessage error={actionError ?? error} /></div>
      {data && services.length === 0 && <p className="mt-4 text-muted">{t('site.services.empty')}</p>}
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {services.map((service) => {
          const cover = service.cover_media_id ? mediaById.get(service.cover_media_id) : undefined
          return (
            <li key={service.id} className="flex items-center gap-3 py-3">
              {cover ? <Picture media={cover} className="size-14 shrink-0 object-cover" sizes="56px" /> : <div className="size-14 shrink-0 bg-tint" />}
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setEditing(service)}>
                <p className="font-bold">{service.title_ar}</p>
                <p className="text-xs text-muted" dir="ltr">/{service.slug}</p>
              </button>
              <button type="button" className={`shrink-0 px-3 py-2 text-xs font-bold ${service.status === 'published' ? 'bg-ok text-white' : 'border border-ink'}`} onClick={() => void toggle(service)}>
                {service.status === 'published' ? t('site.published') : t('site.draft')}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ServiceForm({ service, onDone }: { service: ServiceRow | null; onDone: () => Promise<void> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    slug: service?.slug ?? '', title_ar: service?.title_ar ?? '', title_en: service?.title_en ?? '', summary_ar: service?.summary_ar ?? '',
    summary_en: service?.summary_en ?? '', body_ar: service?.body_ar ?? '', body_en: service?.body_en ?? '', is_featured: service?.is_featured ?? false,
  })
  const [cover, setCover] = useState<string | null>(service?.cover_media_id ?? null)
  // A new service's address follows its English title until the owner types an address of their own.
  const [slugTouched, setSlugTouched] = useState(Boolean(service))
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<ContentError | null>(null)
  const [problem, setProblem] = useState<string | null>(null)     // what the form itself can tell before asking the server
  const [busy, setBusy] = useState(false)
  const set = (field: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [field]: value }))
  const slugValid = SLUG_RE.test(form.slug)

  if (picking) {
    return <MediaLibrary picked={cover ? [cover] : []} onPick={(m: MediaRow) => { setCover(m.id); setPicking(false) }} />
  }

  async function save() {
    setError(null)
    setProblem(null)
    if (!form.title_ar.trim()) return setProblem(t('site.services.needTitle'))
    if (!slugValid) return setProblem(t('site.services.badSlug'))
    setBusy(true)
    try {
      const data = { ...form, cover_media_id: cover }
      if (service) await contentApi.services.save(service, data)
      else await contentApi.services.create(data)
      await onDone()
    } catch (err) {
      setError(asContentError(err))
      setBusy(false)
    }
  }

  async function remove() {
    if (!service || !window.confirm(t('site.confirmDelete'))) return
    try { await contentApi.services.remove(service); await onDone() } catch (err) { setError(asContentError(err)) }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className={labelCls}>{t('site.titleAr')}<input className={inputCls} value={form.title_ar} onChange={(e) => set('title_ar', e.target.value)} /></label>
      <label className={labelCls}>{t('site.titleEn')}
        <input className={inputCls} dir="ltr" value={form.title_en} onChange={(e) => { set('title_en', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)) }} />
      </label>
      <div className="flex flex-col gap-1.5">
        <label className={labelCls}>{t('site.services.slug')}
          <input className={inputCls} dir="ltr" aria-describedby="service-slug-help" value={form.slug} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()) }} />
        </label>
        <span id="service-slug-help" className={`text-xs ${form.slug && !slugValid ? 'font-semibold text-magenta' : 'text-muted'}`}>{t('site.services.slugHelp')}</span>
      </div>
      <label className={labelCls}>{t('site.summaryAr')}<textarea className={inputCls} rows={2} value={form.summary_ar} onChange={(e) => set('summary_ar', e.target.value)} /></label>
      <label className={labelCls}>{t('site.summaryEn')}<textarea className={inputCls} dir="ltr" rows={2} value={form.summary_en} onChange={(e) => set('summary_en', e.target.value)} /></label>
      <label className={labelCls}>{t('site.bodyAr')}<textarea className={inputCls} rows={6} value={form.body_ar} onChange={(e) => set('body_ar', e.target.value)} /></label>
      <label className={labelCls}>{t('site.bodyEn')}<textarea className={inputCls} dir="ltr" rows={6} value={form.body_en} onChange={(e) => set('body_en', e.target.value)} /></label>
      <div>
        <p className="text-sm font-semibold">{t('site.services.cover')}</p>
        <div className="mt-1 flex gap-2">
          <button type="button" className={`${ghostBtn} flex-1`} onClick={() => setPicking(true)}>{cover ? t('site.changePicture') : t('site.choosePicture')}</button>
          {cover && <button type="button" className={ghostBtn} onClick={() => setCover(null)}>{t('site.removePicture')}</button>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} />{t('site.featured')}</label>
      {problem && <p role="alert" className="text-sm font-semibold text-magenta">{problem}</p>}
      <ContentErrorMessage error={error} />
      <div className="flex gap-2">
        <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
        <button type="button" className={ghostBtn} onClick={() => void onDone()}>{t('common.cancel')}</button>
      </div>
      {service && <button type="button" className={`${ghostBtn} text-magenta`} onClick={() => void remove()}>{t('site.delete')}</button>}
    </div>
  )
}
