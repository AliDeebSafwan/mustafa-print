import { useLiveQuery } from 'dexie-react-hooks'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { Permission } from '@mpe/shared'
import { useCan } from '../auth'
import { cn } from '../lib/cn'
import { unresolvedCount } from '../offline/review'
import { ColorBar } from './ColorBar'
import { StatusBar } from './StatusBar'
import { UpdatePrompt } from './UpdatePrompt'

const TABS: readonly { to: string; key: string; end?: true; needs?: Permission }[] = [
  { to: '/', key: 'orders', end: true, needs: 'orders:read' },
  { to: '/scan', key: 'scan', needs: 'orders:status:update' },
  { to: '/products', key: 'products', needs: 'products:write' },
  { to: '/inventory', key: 'inventory', needs: 'inventory:read' },
  { to: '/site', key: 'site', needs: 'content:manage' },
  { to: '/settings', key: 'settings' },
]

export function AppShell() {
  const { t } = useTranslation()
  const can = useCan()
  const { pathname } = useLocation()
  const needsReview = useLiveQuery(unresolvedCount, [], 0)
  const tabs = TABS.filter((tab) => !tab.needs || can(tab.needs))
  return (
    <div className="flex h-full flex-col print:block print:h-auto">
      <div className="print:hidden"><ColorBar /><StatusBar /></div>
      <main className="min-h-0 flex-1 overflow-y-auto print:overflow-visible"><Outlet /></main>
      <nav className="app-chrome grid shrink-0 border-t border-rule pb-[env(safe-area-inset-bottom)] print:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => cn('py-3.5 text-center text-sm font-semibold', isActive || (tab.key === 'orders' && pathname.startsWith('/orders')) ? 'border-t-2 border-magenta bg-tint' : 'text-muted')}>
            {t(`nav.${tab.key}`)}
            {tab.key === 'settings' && needsReview > 0 && (
              <span className="ms-1 inline-block min-w-5 rounded-full bg-magenta px-1.5 text-xs font-bold text-white" aria-label={t('review.pending', { count: needsReview })}>{needsReview}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <UpdatePrompt />
    </div>
  )
}
