import { Route, Routes } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SectionTabs } from '../../components/SectionTabs'
import { MediaLibrary } from '../../components/site/MediaLibrary'
import { GalleryScreen } from './GalleryScreen'
import { ServicesScreen } from './ServicesScreen'
import { ShopDetailsScreen } from './ShopDetailsScreen'

const SECTIONS = [
  { path: '', key: 'services' },
  { path: 'gallery', key: 'gallery' },
  { path: 'media', key: 'media' },
  { path: 'details', key: 'details' },
] as const

/** The owner's editor for the customer website. Needs a connection: nothing here is kept offline. */
export function SitePage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('site.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      <SectionTabs base="/site" label={t('site.title')} tabs={SECTIONS.map((s) => ({ path: s.path, label: t(`site.section.${s.key}`) }))} />
      <div className="mt-4">
        <Routes>
          <Route index element={<ServicesScreen />} />
          <Route path="gallery" element={<GalleryScreen />} />
          <Route path="media" element={<MediaLibrary />} />
          <Route path="details" element={<ShopDetailsScreen />} />
        </Routes>
      </div>
    </section>
  )
}
