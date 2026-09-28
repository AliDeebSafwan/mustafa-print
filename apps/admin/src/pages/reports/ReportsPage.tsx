import { NavLink, Route, Routes } from 'react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { CashClosingScreen } from './CashClosingScreen'
import { DashboardScreen } from './DashboardScreen'
import { ProductionQueueScreen } from './ProductionQueueScreen'
import { UnpaidScreen } from './UnpaidScreen'

const SECTIONS = [
  { to: '', key: 'dashboard', end: true },
  { to: 'unpaid', key: 'unpaid' },
  { to: 'cash-closing', key: 'cashClosing' },
  { to: 'queue', key: 'queue' },
] as const

/** Live views of the shop's own data. Needs a connection: nothing here is kept offline. */
export function ReportsPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('reports.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      <nav className="mt-4 grid grid-cols-4 border border-ink" aria-label={t('reports.title')}>
        {SECTIONS.map((s) => (
          <NavLink key={s.key} to={s.to} end={'end' in s} className={({ isActive }) => cn('py-2.5 text-center text-xs font-semibold sm:text-sm', isActive ? 'bg-ink text-white' : '')}>
            {t(`reports.section.${s.key}`)}
          </NavLink>
        ))}
      </nav>
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
