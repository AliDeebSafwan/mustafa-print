import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useBranch, useCan } from '../../auth'
import { CustomerPicker } from '../../components/order/CustomerPicker'
import { LineEditor } from '../../components/order/LineEditor'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { ContentError, quotesApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { cleanDecimal, evaluateItemsEdit, newLine, type DraftLine } from '../../offline/order-draft'
import { db } from '../../offline/db'
import { requestSync } from '../../offline/request-sync'
import { dateTime, money } from '../../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn, sectionCls } from '../../lib/ui'

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string }

/** Quotes: priced offers the customer accepts from a link. Needs a connection, like invoices. */
export function QuotesPage() {
  const [view, setView] = useState<View>({ kind: 'list' })
  if (view.kind === 'new') return <NewQuote onDone={(id) => setView(id ? { kind: 'detail', id } : { kind: 'list' })} />
  if (view.kind === 'detail') return <QuoteDetailView id={view.id} onBack={() => setView({ kind: 'list' })} />
  return <QuoteList onNew={() => setView({ kind: 'new' })} onOpen={(id) => setView({ kind: 'detail', id })} />
}

function QuoteList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const can = useCan()
  const load = useCallback(() => quotesApi.list(), [])
  const { data, error } = useResource(load)
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('quotes.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      {can('orders:create') && <button type="button" className={`${primaryBtn} mt-4 w-full`} onClick={onNew}>{t('quotes.new')}</button>}
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      {data && data.length === 0 && <p className="mt-4 text-muted">{t('quotes.empty')}</p>}
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {data?.map((q) => (
          <li key={q.id}>
            <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-start" onClick={() => onOpen(q.id)}>
              <div className="min-w-0">
                <p className="font-bold">{q.customer_name}</p>
                <p className="text-xs text-muted"><span dir="ltr">#{q.quote_number}</span> · {dateTime(q.created_at, i18n.language)}</p>
              </div>
              <div className="shrink-0 text-end">
                <p className="font-semibold" dir="ltr">{money(q.total, q.currency)}</p>
                <p className={`text-xs font-semibold ${q.status === 'accepted' ? 'text-ok' : q.status === 'sent' ? 'text-muted' : 'text-magenta'}`}>{t(`quotes.status.${q.status}`)}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NewQuote({ onDone }: { onDone: (id?: string) => void }) {
  const { t } = useTranslation()
  const branch = useBranch()
  const can = useCan()
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([newLine()])
  const [discount, setDiscount] = useState('')
  const [validDays, setValidDays] = useState('14')
  const [notes, setNotes] = useState('')
  const [showIssues, setShowIssues] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const currency = branch?.baseCurrency ?? 'USD'
  const evaluation = evaluateItemsEdit(lines, discount, '0', { maxDiscountPercent: branch?.maxDiscountPercent ?? null, mayOverrideDiscount: can('orders:discount:override') })
  const days = Number(validDays)
  const daysOk = Number.isInteger(days) && days >= 1 && days <= 90

  async function save() {
    setShowIssues(true)
    setFailure(null)
    if (!customerId || evaluation.issues.length > 0 || !daysOk) return
    const customer = await db.customers.get(customerId)
    if (customer?._pending) {
      // Created on this device a moment ago and not yet on the server: a quote needs the server to know them.
      requestSync()
      return setFailure(t('quotes.customerNotSynced'))
    }
    setBusy(true)
    try {
      const created = await quotesApi.create({
        customer_id: customerId, valid_days: days, ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(discount.trim() ? { discount_total: discount.trim() } : {}),
        items: evaluation.lines.map((l) => ({ name: l.name.trim(), quantity: l.quantity, unit_price: l.unitPrice, ...(l.discount.trim() ? { discount: l.discount } : {}), ...(l.productId ? { product_id: l.productId } : {}) })),
      })
      onDone(created.id)
    } catch (err) {
      const detail = err instanceof ContentError ? err.detail : undefined
      setFailure(err instanceof ContentError && err.code === 'offline' ? t('site.error.offline')
        : detail?.startsWith('discount_too_large') ? t('issue.discount_cap', { percent: branch?.maxDiscountPercent ?? 0 })
        : err instanceof ContentError && err.code === 'not_found' ? t('quotes.customerNotSynced') : t('common.error'))
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-2xl p-4 pb-6">
      <h1 className="text-2xl font-extrabold">{t('quotes.new')}</h1>
      <div className={sectionCls}><CustomerPicker customerId={customerId} onChange={setCustomerId} /></div>
      <div className={sectionCls}>
        <h2 className="mb-2 font-bold">{t('newOrder.items')}</h2>
        <LineEditor lines={lines} lineTotals={evaluation.totals?.lines} currency={currency} onChange={setLines} customerId={customerId} />
      </div>
      <div className={`${sectionCls} grid grid-cols-2 gap-3`}>
        <label className={labelCls}>{t('newOrder.discountTotal')}
          <input className={inputCls} dir="ltr" inputMode="decimal" value={discount} onChange={(e) => setDiscount(cleanDecimal(e.target.value))} />
        </label>
        <label className={labelCls}>{t('quotes.validDays')}
          <input className={inputCls} dir="ltr" inputMode="numeric" value={validDays} onChange={(e) => setValidDays(e.target.value.replace(/\D/g, ''))} />
        </label>
      </div>
      <label className={`${labelCls} mt-3`}>{t('quotes.notes')}
        <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-ink bg-white p-4">
        {showIssues && (!customerId || evaluation.issues.length > 0 || !daysOk) && (
          <ul role="alert" className="mb-3 list-disc ps-5 text-sm font-semibold text-magenta">
            {!customerId && <li>{t('issue.customer')}</li>}
            {evaluation.issues.map((issue, i) => <li key={`${issue.code}-${i}`}>{t(`issue.${issue.code}`, { n: issue.line, percent: branch?.maxDiscountPercent ?? 0 })}</li>)}
            {!daysOk && <li>{t('quotes.badDays')}</li>}
          </ul>
        )}
        {failure && <p role="alert" className="mb-3 text-sm font-semibold text-magenta">{failure}</p>}
        <p className="mb-3 flex justify-between text-lg font-extrabold"><span>{t('newOrder.total')}</span><span dir="ltr">{evaluation.totals ? money(evaluation.totals.total, currency) : '—'}</span></p>
        <div className="flex gap-2">
          <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{t('quotes.issue')}</button>
          <button type="button" className={ghostBtn} onClick={() => onDone()}>{t('common.cancel')}</button>
        </div>
      </div>
    </section>
  )
}

function QuoteDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, i18n } = useTranslation()
  const can = useCan()
  const load = useCallback(() => quotesApi.detail(id), [id])
  const { data, error, reload } = useResource(load)
  const [message, setMessage] = useState<string | null>(null)

  if (!data) return <section className="mx-auto max-w-2xl p-4"><ContentErrorMessage error={error} /></section>
  const phoneDigits = data.customer_phone?.replace(/\D/g, '') ?? ''
  const shareText = t('quotes.shareText', { number: data.quote_number, total: money(data.total, data.currency), link: data.link })

  async function copy() {
    await navigator.clipboard?.writeText(data!.link).catch(() => undefined)
    setMessage(t('quotes.copied'))
  }
  async function withdraw() {
    if (!window.confirm(t('quotes.confirmCancel'))) return
    try { await quotesApi.cancel(id); await reload() } catch { setMessage(t('common.error')) }
  }

  return (
    <section className="mx-auto max-w-2xl p-4">
      <button type="button" className="text-sm text-muted underline" onClick={onBack}>{t('quotes.back')}</button>
      <h1 className="mt-2 text-2xl font-extrabold">{t('quotes.title')} <span dir="ltr">#{data.quote_number}</span></h1>
      <p className="text-sm text-muted">{data.customer_name} · {t(`quotes.status.${data.status}`)}</p>
      <p className="text-sm text-muted">{t('quotes.validUntil', { date: dateTime(data.valid_until, i18n.language) })}</p>
      {data.decline_reason && <p className="mt-2 border-s-4 border-magenta bg-tint p-2 text-sm">{t('quotes.declineReason')}: {data.decline_reason}</p>}

      <ul className="mt-4 divide-y divide-rule border-y border-rule text-sm">
        {data.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3 py-2">
            <span>{item.name} <span className="text-muted" dir="ltr">× {Number(item.quantity)}</span></span>
            <span dir="ltr">{money(item.line_total, data.currency)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex justify-between text-lg font-extrabold"><span>{t('newOrder.total')}</span><span dir="ltr">{money(data.total, data.currency)}</span></p>

      {message && <p role="status" className="mt-3 text-sm font-semibold text-ok">{message}</p>}
      {data.status === 'sent' && (
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" className={primaryBtn} onClick={() => void copy()}>{t('quotes.copyLink')}</button>
          {phoneDigits && (
            <a className={`${ghostBtn} text-center`} target="_blank" rel="noopener noreferrer" href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(shareText)}`}>{t('quotes.sendWhatsapp')}</a>
          )}
          {can('orders:update') && <button type="button" className={ghostBtn} onClick={() => void withdraw()}>{t('quotes.cancel')}</button>}
        </div>
      )}
      {data.status === 'accepted' && data.order_id && (
        <Link to={`/orders/${data.order_id}`} className={`${primaryBtn} mt-4 block text-center`}>{t('quotes.openOrder')}</Link>
      )}
    </section>
  )
}
