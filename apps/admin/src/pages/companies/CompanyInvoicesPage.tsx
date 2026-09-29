import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatCents, toCents } from '@mpe/shared'
import { useCan } from '../../auth'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { ContentError, companyInvoicesApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { requestSync } from '../../offline/request-sync'
import { dateTime, money } from '../../lib/format'
import { primaryBtn } from '../../lib/ui'

/** A company's orders not yet invoiced, and the consolidated invoices already issued. Online, like any invoice. */
export function CompanyInvoicesPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const can = useCan()
  const { id = '' } = useParams()
  const loadUnbilled = useCallback(() => companyInvoicesApi.unbilled(id), [id])
  const loadIssued = useCallback(() => companyInvoicesApi.list(id), [id])
  const unbilled = useResource(loadUnbilled)
  const issued = useResource(loadIssued)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const orders = unbilled.data ?? []
  const chosen = orders.filter((o) => !excluded.has(o.id))
  const currency = orders[0]?.currency ?? 'USD'
  const totalCents = chosen.reduce((sum, o) => sum + (toCents(o.total) ?? 0), 0)
  const toggle = (orderId: string) => setExcluded((s) => { const n = new Set(s); if (n.has(orderId)) n.delete(orderId); else n.add(orderId); return n })

  async function issue() {
    if (chosen.length === 0) return
    if (!window.confirm(t('company.invoices.confirm', { count: chosen.length, total: money(formatCents(totalCents), currency) }))) return
    setBusy(true)
    setFailure(null)
    try {
      const invoice = await companyInvoicesApi.issue(id, chosen.map((o) => o.id))
      requestSync()
      navigate(`/company-invoices/${invoice.id}`)
    } catch (err) {
      const detail = err instanceof ContentError ? err.detail : undefined
      setFailure(detail === 'already_invoiced' ? t('company.invoices.alreadyInvoiced') : detail === 'not_a_company' ? t('company.invoices.notACompany')
        : err instanceof ContentError && err.code === 'offline' ? t('site.error.offline') : t('common.error'))
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-xl p-4">
      <button type="button" className="text-sm text-muted underline" onClick={() => navigate(-1)}><span className="arrow-back" aria-hidden="true">←</span> {t('common.back')}</button>
      <h1 className="mt-2 text-2xl font-extrabold">{t('company.invoices.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('company.invoices.help')}</p>

      <h2 className="mt-6 mb-2 font-bold">{t('company.invoices.unbilled')}</h2>
      <ContentErrorMessage error={unbilled.error} />
      {unbilled.data && orders.length === 0 && <p className="text-sm text-muted">{t('company.invoices.nothingToBill')}</p>}
      {orders.length > 0 && (
        <>
          <ul className="divide-y divide-rule border-y border-rule">
            {orders.map((o) => (
              <li key={o.id}>
                <label className="flex items-center gap-3 py-2.5">
                  <input type="checkbox" className="size-5" checked={!excluded.has(o.id)} onChange={() => toggle(o.id)} aria-label={`#${o.order_number ?? o.public_code}`} />
                  <span className="flex-1"><span dir="ltr">#{o.order_number ?? o.public_code}</span> <span className="text-xs text-muted">{dateTime(o.placed_at, i18n.language)}</span></span>
                  <span className="font-semibold" dir="ltr">{money(o.total, o.currency)}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between text-lg font-extrabold"><span>{t('company.invoices.selected', { count: chosen.length })}</span><span dir="ltr">{money(formatCents(totalCents), currency)}</span></p>
          {failure && <p role="alert" className="mt-2 text-sm font-semibold text-magenta">{failure}</p>}
          {can('orders:update') && (
            <button type="button" className={`${primaryBtn} mt-3 w-full`} disabled={busy || chosen.length === 0} onClick={() => void issue()}>{t('company.invoices.issue')}</button>
          )}
        </>
      )}

      <h2 className="mt-8 mb-2 font-bold">{t('company.invoices.issued')}</h2>
      <ContentErrorMessage error={issued.error} />
      {issued.data && issued.data.length === 0 && <p className="text-sm text-muted">{t('company.invoices.noneIssued')}</p>}
      <ul className="divide-y divide-rule border-y border-rule">
        {issued.data?.map((inv) => (
          <li key={inv.id}>
            <Link to={`/company-invoices/${inv.id}`} className="flex items-center justify-between gap-3 py-2.5">
              <span><span className="font-semibold" dir="ltr">#{inv.invoice_number}</span> <span className="text-xs text-muted">{dateTime(inv.issued_at, i18n.language)} · {t('company.invoices.orderCount', { count: inv.order_count })}</span></span>
              <span className="font-semibold" dir="ltr">{money(inv.total, inv.currency)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
