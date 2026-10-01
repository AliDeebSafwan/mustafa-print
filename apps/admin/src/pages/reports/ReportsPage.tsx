import { Route, Routes } from 'react-router'
import { useTranslation } from 'react-i18next'
import { SectionTabs } from '../../components/SectionTabs'
import { CashClosingScreen } from './CashClosingScreen'
import { DashboardScreen } from './DashboardScreen'
import { ProductionQueueScreen } from './ProductionQueueScreen'
import { UnpaidScreen } from './UnpaidScreen'

const SECTIONS = [
  { path: '', key: 'dashboard' },
  { path: 'unpaid', key: 'unpaid' },
  { path: 'cash-closing', key: 'cashClosing' },
  { path: 'queue', key: 'queue' },
] as const

/** Live views of the shop's own data. Needs a connection: nothing here is kept offline. */
export function ReportsPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('reports.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      <SectionTabs base="/reports" label={t('reports.title')} className="text-xs sm:text-sm" tabs={SECTIONS.map((s) => ({ path: s.path, label: t(`reports.section.${s.key}`) }))} />
      <div className="mt-4">
        <Routes>
          <Route index element={<DashboardScreen />} />
          <Route path="unpaid" element={<UnpaidScreen />} />
          <Route path="cash-closing" element={<CashClosingScreen />} />
          <Route path="queue" element={<ProductionQueueScreen />} />
        </Routes>
      </div>
    </section>
  )
}
