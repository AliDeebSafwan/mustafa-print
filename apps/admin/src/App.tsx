import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from './auth'
import { AppShell } from './components/AppShell'
import { syncDeps } from './offline/deps'
import { startAutoSync } from './offline/sync'
import { EditCustomerPage } from './pages/EditCustomerPage'
import { EditOrderPage } from './pages/EditOrderPage'
import { InventoryPage } from './pages/InventoryPage'
import { EditOrderItemsPage } from './pages/EditOrderItemsPage'
import { InvoicePage } from './pages/InvoicePage'
import { LabelPage } from './pages/LabelPage'
import { LoginPage } from './pages/LoginPage'
import { MessagesPage } from './pages/MessagesPage'
import { ReconciliationPage } from './pages/ReconciliationPage'
import { CustomerAccountsPage } from './pages/CustomerAccountsPage'
import { QuotesPage } from './pages/QuotesPage'
import { CompanyPricingPage } from './pages/CompanyPricingPage'
import { ImportProductsPage } from './pages/ImportProductsPage'
import { ImportInventoryPage } from './pages/ImportInventoryPage'
import { LaunchChecklistPage } from './pages/LaunchChecklistPage'
import { CompanyInvoicesPage } from './pages/CompanyInvoicesPage'
import { CompanyInvoicePage } from './pages/CompanyInvoicePage'
import { NewOrderPage } from './pages/NewOrderPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { OrdersPage } from './pages/OrdersPage'
import { ProductsPage } from './pages/ProductsPage'
import { ReviewPage } from './pages/ReviewPage'
import { ScanPage } from './pages/ScanPage'
import { SettingsPage } from './pages/SettingsPage'
import { SitePage } from './pages/site/SitePage'
import { ReportsPage } from './pages/reports/ReportsPage'
import { TeamPage } from './pages/team/TeamPage'

/** Syncing only makes sense (and is only started) while someone is signed in. */
function SignedInApp() {
  useEffect(() => startAutoSync(syncDeps), [])
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="orders/:id/edit" element={<EditOrderPage />} />
        <Route path="customers/:id/edit" element={<EditCustomerPage />} />
        <Route path="orders/:id/label" element={<LabelPage />} />
        <Route path="orders/:id/invoice" element={<InvoicePage />} />
        <Route path="orders/:id/edit-items" element={<EditOrderItemsPage />} />
        <Route path="reconcile" element={<ReconciliationPage />} />
        <Route path="customer-accounts" element={<CustomerAccountsPage />} />
        <Route path="quotes" element={<QuotesPage />} />
        <Route path="customers/:id/pricing" element={<CompanyPricingPage />} />
        <Route path="products/import" element={<ImportProductsPage />} />
        <Route path="inventory/import" element={<ImportInventoryPage />} />
        <Route path="checklist" element={<LaunchChecklistPage />} />
        <Route path="customers/:id/invoices" element={<CompanyInvoicesPage />} />
        <Route path="company-invoices/:id" element={<CompanyInvoicePage />} />
        <Route path="scan" element={<ScanPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="site/*" element={<SitePage />} />
        <Route path="team/*" element={<TeamPage />} />
        <Route path="reports/*" element={<ReportsPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const { t } = useTranslation()
  const state = useAuth()
  if (state.status === 'loading') return <p role="status" className="p-6 text-muted">{t('login.loading')}</p>
  return state.status === 'signed_in' ? <SignedInApp /> : <LoginPage />
}
