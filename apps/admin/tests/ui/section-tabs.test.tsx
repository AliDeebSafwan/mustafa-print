// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The screens behind each tab are stubbed: this file is about switching between them, not what they show.
const stub = vi.hoisted(() => (name: string) => () => <p>{name} SCREEN</p>)
vi.mock('../../src/pages/site/ServicesScreen', () => ({ ServicesScreen: stub('SERVICES') }))
vi.mock('../../src/pages/site/GalleryScreen', () => ({ GalleryScreen: stub('GALLERY') }))
vi.mock('../../src/components/site/MediaLibrary', () => ({ MediaLibrary: stub('MEDIA') }))
vi.mock('../../src/pages/site/ShopDetailsScreen', () => ({ ShopDetailsScreen: stub('DETAILS') }))
vi.mock('../../src/pages/team/StaffScreen', () => ({ StaffScreen: stub('STAFF') }))
vi.mock('../../src/pages/team/AuditLogScreen', () => ({ AuditLogScreen: stub('AUDIT') }))
vi.mock('../../src/pages/team/ShopSettingsScreen', () => ({ ShopSettingsScreen: stub('SETTINGS') }))
vi.mock('../../src/pages/reports/DashboardScreen', () => ({ DashboardScreen: stub('DASHBOARD') }))
vi.mock('../../src/pages/reports/UnpaidScreen', () => ({ UnpaidScreen: stub('UNPAID') }))
vi.mock('../../src/pages/reports/CashClosingScreen', () => ({ CashClosingScreen: stub('CASH') }))
vi.mock('../../src/pages/reports/ProductionQueueScreen', () => ({ ProductionQueueScreen: stub('QUEUE') }))

import { SitePage } from '../../src/pages/site/SitePage'
import { TeamPage } from '../../src/pages/team/TeamPage'
import { ReportsPage } from '../../src/pages/reports/ReportsPage'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en') })

/** Every tab is clicked from every other tab: the bug only showed once you were already off the first tab. */
const pages = [
  { base: '/site', element: <SitePage />, tabs: [['Services', '', 'SERVICES'], ['Showroom', 'gallery', 'GALLERY'], ['Pictures', 'media', 'MEDIA'], ['Shop details', 'details', 'DETAILS']] },
  { base: '/team', element: <TeamPage />, tabs: [['Staff', '', 'STAFF'], ['Audit log', 'audit-log', 'AUDIT'], ['Settings', 'settings', 'SETTINGS']] },
  { base: '/reports', element: <ReportsPage />, tabs: [['Today', '', 'DASHBOARD'], ['Unpaid', 'unpaid', 'UNPAID'], ['Cash closing', 'cash-closing', 'CASH'], ['Production queue', 'queue', 'QUEUE']] },
] as const

describe.each(pages)('the $base section tabs', ({ base, element, tabs }) => {
  it('links every tab to its own address, whichever tab is open', async () => {
    for (const [, fromPath] of tabs) {
      await resetApp('en')
      renderAt(fromPath ? `${base}/${fromPath}` : base, [{ path: `${base}/*`, element }])
      for (const [name, path] of tabs) {
        expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(path ? `${base}/${path}` : base)
      }
    }
  })

  it('switches the screen and the highlighted tab on every click, in any order', async () => {
    const user = userEvent.setup()
    renderAt(base, [{ path: `${base}/*`, element }])
    const order = [...tabs.slice(1), tabs[0], ...[...tabs].reverse()]
    for (const [name, , screenName] of order) {
      await user.click(screen.getByRole('link', { name }))
      expect(screen.getByText(`${screenName} SCREEN`)).toBeTruthy()
      for (const [other] of tabs) {
        expect(screen.getByRole('link', { name: other }).getAttribute('aria-current')).toBe(other === name ? 'page' : null)
      }
    }
  })
})
