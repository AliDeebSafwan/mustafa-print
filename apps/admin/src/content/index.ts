import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { createContentApi } from './api'

export const contentApi = createContentApi({ baseUrl: API_URL, getToken: () => auth.getAccessToken() })
export { ContentError, type ContentErrorCode, type GalleryRow, type MediaRow, type ServiceRow, type SettingsRow } from './api'
export { ordersApi, type OrderFile } from './orders-api'
export { reportsApi, type CashClosingReport, type DashboardReport, type QueueRow, type TillEntry, type UnpaidRow } from './reports-api'
export { teamApi, type AuditEntry, type BranchSettingsRow, type StaffRow } from './team-api'
export { customerAccountsApi, type AccountCandidate, type AccountDetail, type AccountRow } from './customer-accounts-api'
export { quotesApi, type QuoteDetail, type QuoteRow } from './quotes-api'
export { proofsApi, type ProofRow } from './proofs-api'
export { pushApi } from './push-api'
export { companyInvoicesApi, type CompanyInvoice, type CompanyInvoiceRow, type UnbilledOrder } from './company-invoices-api'
