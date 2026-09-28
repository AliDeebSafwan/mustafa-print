import 'fake-indexeddb/auto'
import { cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import i18n from '../../src/i18n'
import { db } from '../../src/offline/db'

/** Renders a page at `path` inside the router, with `/orders/:id` stubbed so navigation results are visible. */
export function renderAt(path: string, routes: { path: string; element: ReactElement }[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route path="/orders/:id" element={<p>DETAIL PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

export async function resetApp(lang: 'en' | 'ar' = 'en') {
  cleanup()                                   // unmount the previous test's screen (auto-cleanup needs vitest globals)
  await Promise.all(db.tables.map((t) => t.clear()))
  await i18n.changeLanguage(lang)
}

/** The signed-in staff member the UI tests pretend to be. Mutate it inside a test to change role. */
export interface FakeSession {
  role: string; id: string; maxDiscountPercent: number | null
  legalNameAr?: string | null; legalNameEn?: string | null; taxNumber?: string | null
  vatEnabled?: boolean; vatRatePercent?: number; invoiceFooterAr?: string | null; invoiceFooterEn?: string | null
  depositPercent?: number; depositThreshold?: number | null
}

/**
 * Builds the `src/auth` mock from a session object. Keeping it here means a new hook is added in one place
 * instead of breaking every screen test.
 */
export async function authMock(session: FakeSession) {
  const { hasPermission, roleDefinition } = await import('@mpe/shared')
  const state = () => ({
    status: 'signed_in' as const,
    user: { id: session.id, role: session.role, fullName: 'Staff', branchId: 'b1', locale: 'ar', permissions: roleDefinition(session.role)!.permissions },
    branch: {
      id: 'b1', nameAr: 'المصطفى', nameEn: 'Mustafa', baseCurrency: 'USD', maxDiscountPercent: session.maxDiscountPercent,
      legalNameAr: session.legalNameAr ?? null, legalNameEn: session.legalNameEn ?? null, taxNumber: session.taxNumber ?? null,
      vatEnabled: session.vatEnabled ?? false, vatRatePercent: session.vatRatePercent ?? 0,
      invoiceFooterAr: session.invoiceFooterAr ?? null, invoiceFooterEn: session.invoiceFooterEn ?? null,
      depositPercent: session.depositPercent ?? 0, depositThreshold: session.depositThreshold ?? null,
    },
  })
  return {
    auth: {},
    useAuth: state,
    useBranch: () => state().branch,
    useCan: () => (permission: Parameters<typeof hasPermission>[1]) => hasPermission(roleDefinition(session.role)!.permissions, permission),
  }
}
