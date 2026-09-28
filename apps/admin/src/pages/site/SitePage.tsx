import { NavLink, Route, Routes } from 'react-router'
import { useTranslation } from 'react-i18next'
import { MediaLibrary } from '../../components/site/MediaLibrary'
import { cn } from '../../lib/cn'
import { GalleryScreen } from './GalleryScreen'
import { ServicesScreen } from './ServicesScreen'
import { ShopDetailsScreen } from './ShopDetailsScreen'

const SECTIONS = [
  { to: '', key: 'services', end: true },
  { to: 'gallery', key: 'gallery' },
  { to: 'media', key: 'media' },
  { to: 'details', key: 'details' },
] as const

/** The owner's editor for the customer website. Needs a connection: nothing here is kept offline. */
export function SitePage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('site.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      <nav className="mt-4 grid grid-cols-4 border border-ink" aria-label={t('site.title')}>
        {SECTIONS.map((s) => (
          <NavLink key={s.key} to={s.to} end={'end' in s} className={({ isActive }) => cn('py-2.5 text-center text-sm font-semibold', isActive ? 'bg-ink text-white' : '')}>
            {t(`site.section.${s.key}`)}
          </NavLink>
        ))}
      </nav>
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
