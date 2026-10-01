import { Route, Routes } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SectionTabs } from '../../components/SectionTabs'
import { AuditLogScreen } from './AuditLogScreen'
import { ShopSettingsScreen } from './ShopSettingsScreen'
import { StaffScreen } from './StaffScreen'

const SECTIONS = [
  { path: '', key: 'staff' },
  { path: 'audit-log', key: 'auditLog' },
  { path: 'settings', key: 'settings' },
] as const

/** The owner's tools for the team and the shop's business rules. Needs a connection: nothing here is kept offline. */
export function TeamPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('team.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      <SectionTabs base="/team" label={t('team.title')} tabs={SECTIONS.map((s) => ({ path: s.path, label: t(`team.section.${s.key}`) }))} />
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
