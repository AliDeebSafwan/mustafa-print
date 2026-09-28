import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { contentApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { MediaLibrary } from '../site/MediaLibrary'
import { inputCls, labelCls, ghostBtn } from '../../lib/ui'

export interface WebsiteFields { is_public: boolean; description_ar: string; description_en: string; cover_media_id: string | null; service_id: string | null }

/**
 * How a product appears on the customer website. Choosing the picture or the linked service needs a connection
 * (both live on the server); everything else is saved with the product and can be queued offline like any other edit.
 */
export function WebsiteSection({ value, onChange, lang }: { value: WebsiteFields; onChange: (patch: Partial<WebsiteFields>) => void; lang: 'ar' | 'en' }) {
  const { t } = useTranslation()
  const [picking, setPicking] = useState(false)
  const { data: services } = useResource(() => contentApi.services.list())

  if (picking) {
    return (
      <div className="border border-ink p-3">
        <button type="button" className={`${ghostBtn} mb-3 w-full`} onClick={() => setPicking(false)}>{t('common.cancel')}</button>
        <MediaLibrary picked={value.cover_media_id ? [value.cover_media_id] : []} onPick={(m) => { onChange({ cover_media_id: m.id }); setPicking(false) }} />
      </div>
    )
  }

  return (
    <fieldset className="flex flex-col gap-3 border border-rule p-3">
      <legend className="px-1 font-semibold">{t('products.website.title')}</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-5" checked={value.is_public} onChange={(e) => onChange({ is_public: e.target.checked })} />
        <span>{t('products.website.show')}</span>
      </label>
      <label className={labelCls}>{t('site.descriptionAr')}<textarea className={inputCls} rows={2} value={value.description_ar} onChange={(e) => onChange({ description_ar: e.target.value })} /></label>
      <label className={labelCls}>{t('site.descriptionEn')}<textarea className={inputCls} dir="ltr" rows={2} value={value.description_en} onChange={(e) => onChange({ description_en: e.target.value })} /></label>
      <div className="flex gap-2">
        <button type="button" className={`${ghostBtn} flex-1`} onClick={() => setPicking(true)}>{value.cover_media_id ? t('site.changePicture') : t('site.choosePicture')}</button>
        {value.cover_media_id && <button type="button" className={ghostBtn} onClick={() => onChange({ cover_media_id: null })}>{t('site.removePicture')}</button>}
      </div>
      {services && services.length > 0 && (
        <label className={labelCls}>{t('products.website.service')}
          <select className={inputCls} value={value.service_id ?? ''} onChange={(e) => onChange({ service_id: e.target.value || null })}>
            <option value="">{t('products.website.noService')}</option>
            {services.map((s) => <option key={s.id} value={s.id}>{(lang === 'en' ? s.title_en : s.title_ar) || s.title_ar}</option>)}
          </select>
          <span className="text-xs font-normal text-muted">{t('products.website.serviceHelp')}</span>
        </label>
      )}
      <p className="text-xs text-muted">{t('products.website.help')}</p>
    </fieldset>
  )
}
