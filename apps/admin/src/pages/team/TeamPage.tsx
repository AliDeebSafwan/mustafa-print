import { NavLink, Route, Routes } from 'react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { AuditLogScreen } from './AuditLogScreen'
import { ShopSettingsScreen } from './ShopSettingsScreen'
import { StaffScreen } from './StaffScreen'

const SECTIONS = [
  { to: '', key: 'staff', end: true },
  { to: 'audit-log', key: 'auditLog' },
  { to: 'settings', key: 'settings' },
] as const

/** The owner's tools for the team and the shop's business rules. Needs a connection: nothing here is kept offline. */
export function TeamPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('team.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      <nav className="mt-4 grid grid-cols-3 border border-ink" aria-label={t('team.title')}>
        {SECTIONS.map((s) => (
          <NavLink key={s.key} to={s.to} end={'end' in s} className={({ isActive }) => cn('py-2.5 text-center text-sm font-semibold', isActive ? 'bg-ink text-white' : '')}>
            {t(`team.section.${s.key}`)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-4">
        <Routes>
          <Route index element={<StaffScreen />} />
          <Route path="audit-log" element={<AuditLogScreen />} />
          <Route path="settings" element={<ShopSettingsScreen />} />
        </Routes>
      </div>
    </section>
  )
}
