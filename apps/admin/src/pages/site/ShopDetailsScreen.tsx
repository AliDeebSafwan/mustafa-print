import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizePhone, PRICE_DISPLAYS, SOCIAL_NETWORKS } from '@mpe/shared'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { MediaLibrary } from '../../components/site/MediaLibrary'
import { ContentError, contentApi, type SettingsRow } from '../../content'
import { useResource } from '../../content/use-resource'
import { DEFAULT_CALLING_CODE } from '../../lib/config'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

type Hours = { days_ar: string; days_en: string; opens: string; closes: string }
const text = (v: unknown) => (typeof v === 'string' ? v : '')

/** The shop's details on the website: how to reach it, when it is open, and how prices are shown. */
export function ShopDetailsScreen() {
  const load = useCallback(() => contentApi.settings.get(), [])
  const { data, error, reload } = useResource(load)
  if (!data) return <ContentErrorMessage error={error} />
  // Keyed on the version: after a save the form starts again from what the server now holds.
  return <DetailsForm key={data.row_version} settings={data} onSaved={reload} />
}

function DetailsForm({ settings, onSaved }: { settings: SettingsRow; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    tagline_ar: text(settings.tagline_ar), tagline_en: text(settings.tagline_en), about_ar: text(settings.about_ar), about_en: text(settings.about_en),
    phone: text(settings.phone), whatsapp: text(settings.whatsapp), email: text(settings.email), address_ar: text(settings.address_ar),
    address_en: text(settings.address_en), map_url: text(settings.map_url), price_display: text(settings.price_display) || 'from',
  })
  const [hours, setHours] = useState<Hours[]>(((settings.opening_hours as Hours[]) ?? []).map((h) => ({ ...h, days_en: h.days_en ?? '' })))
  const [social, setSocial] = useState<Record<string, string>>((settings.social_links as Record<string, string>) ?? {})
  const [hero, setHero] = useState<string | null>((settings.hero_media_id as string | null) ?? null)
  const [picking, setPicking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [error, setError] = useState<ContentError | null>(null)
  const [saved, setSaved] = useState(false)
  const set = (field: keyof typeof form, value: string) => { setForm((f) => ({ ...f, [field]: value })); setSaved(false) }

  if (picking) return <MediaLibrary picked={hero ? [hero] : []} onPick={(m) => { setHero(m.id); setPicking(false) }} />

  async function save() {
    setProblem(null)
    setError(null)
    // Phones are stored in international form; accept what the owner types ("03 123 456") and convert it.
    const phone = form.phone.trim() ? normalizePhone(form.phone, DEFAULT_CALLING_CODE) : null
    const whatsapp = form.whatsapp.trim() ? normalizePhone(form.whatsapp, DEFAULT_CALLING_CODE) : null
    if ((form.phone.trim() && !phone) || (form.whatsapp.trim() && !whatsapp)) return setProblem(t('customer.badPhone'))
    try {
      await contentApi.settings.save(settings, {
        ...form, phone, whatsapp, email: form.email.trim() || null, map_url: form.map_url.trim() || null,
        price_display: form.price_display as (typeof PRICE_DISPLAYS)[number],
        opening_hours: hours.filter((h) => h.days_ar.trim()).map((h) => ({ ...h, days_en: h.days_en.trim() || null })),
        social_links: Object.fromEntries(Object.entries(social).filter(([, url]) => url.trim())),
        hero_media_id: hero,
      })
      setSaved(true)
      await onSaved()
    } catch (err) {
      setError(err instanceof ContentError ? err : new ContentError('server'))
    }
  }

  const field = (key: keyof typeof form, label: string, opts: { ltr?: boolean; area?: boolean; inputMode?: 'tel' | 'email' | 'url' } = {}) => (
    <label className={labelCls}>{label}
      {opts.area
        ? <textarea className={inputCls} rows={3} dir={opts.ltr ? 'ltr' : undefined} value={form[key]} onChange={(e) => set(key, e.target.value)} />
        : <input className={inputCls} dir={opts.ltr ? 'ltr' : undefined} inputMode={opts.inputMode} value={form[key]} onChange={(e) => set(key, e.target.value)} />}
    </label>
  )

  return (
    <div className="flex flex-col gap-3">
      {field('tagline_ar', t('site.details.taglineAr'))}
      {field('tagline_en', t('site.details.taglineEn'), { ltr: true })}
      {field('about_ar', t('site.details.aboutAr'), { area: true })}
      {field('about_en', t('site.details.aboutEn'), { ltr: true, area: true })}
      <div>
        <p className="text-sm font-semibold">{t('site.details.hero')}</p>
        <div className="mt-1 flex gap-2">
          <button type="button" className={`${ghostBtn} flex-1`} onClick={() => setPicking(true)}>{hero ? t('site.changePicture') : t('site.choosePicture')}</button>
          {hero && <button type="button" className={ghostBtn} onClick={() => setHero(null)}>{t('site.removePicture')}</button>}
        </div>
      </div>
      {field('phone', t('customer.phone'), { ltr: true, inputMode: 'tel' })}
      {field('whatsapp', t('site.details.whatsapp'), { ltr: true, inputMode: 'tel' })}
      {field('email', t('customer.email'), { ltr: true, inputMode: 'email' })}
      {field('address_ar', t('site.details.addressAr'))}
      {field('address_en', t('site.details.addressEn'), { ltr: true })}
      {field('map_url', t('site.details.map'), { ltr: true, inputMode: 'url' })}

      <div className="border border-rule p-3">
        <p className="text-sm font-semibold">{t('site.details.hours')}</p>
        {hours.map((h, i) => (
          <div key={i} className="mt-2 grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder={t('site.details.daysAr')} aria-label={t('site.details.daysAr')} value={h.days_ar} onChange={(e) => setHours((all) => all.map((x, j) => (j === i ? { ...x, days_ar: e.target.value } : x)))} />
            <input className={inputCls} dir="ltr" placeholder={t('site.details.daysEn')} aria-label={t('site.details.daysEn')} value={h.days_en} onChange={(e) => setHours((all) => all.map((x, j) => (j === i ? { ...x, days_en: e.target.value } : x)))} />
            <input className={inputCls} type="time" aria-label={t('site.details.opens')} value={h.opens} onChange={(e) => setHours((all) => all.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)))} />
            <input className={inputCls} type="time" aria-label={t('site.details.closes')} value={h.closes} onChange={(e) => setHours((all) => all.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)))} />
          </div>
        ))}
        <button type="button" className={`${ghostBtn} mt-2 w-full`} onClick={() => setHours((all) => [...all, { days_ar: '', days_en: '', opens: '09:00', closes: '18:00' }])}>{t('site.details.addHours')}</button>
      </div>

      <div className="border border-rule p-3">
        <p className="text-sm font-semibold">{t('site.details.social')}</p>
        {SOCIAL_NETWORKS.map((network) => (
          <label key={network} className="mt-2 flex flex-col gap-1 text-xs font-semibold capitalize">{network}
            <input className={inputCls} dir="ltr" inputMode="url" placeholder="https://" value={social[network] ?? ''} onChange={(e) => setSocial((s) => ({ ...s, [network]: e.target.value }))} />
          </label>
        ))}
      </div>

      <label className={labelCls}>{t('site.details.priceDisplay')}
        <select className={inputCls} value={form.price_display} onChange={(e) => set('price_display', e.target.value)}>
          {PRICE_DISPLAYS.map((d) => <option key={d} value={d}>{t(`site.details.price.${d}`)}</option>)}
        </select>
      </label>

      {problem && <p role="alert" className="text-sm font-semibold text-magenta">{problem}</p>}
      <ContentErrorMessage error={error} />
      {saved && <p role="status" className="text-sm font-semibold text-ok">{t('site.details.saved')}</p>}
      <button type="button" className={primaryBtn} onClick={() => void save()}>{t('common.save')}</button>
    </div>
  )
}
