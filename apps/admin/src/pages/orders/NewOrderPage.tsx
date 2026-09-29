import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useBranch, useCan } from '../../auth'
import { CustomerPicker } from '../../components/order/CustomerPicker'
import { LineEditor } from '../../components/order/LineEditor'
import { InvalidMutationError, InvalidOrderError, createOrderLocally } from '../../offline/actions'
import { cleanDecimal, draftToInput, emptyDraft, evaluateDraft, type OrderDraft } from '../../offline/order-draft'
import { requestSync } from '../../offline/request-sync'
import { money } from '../../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn, sectionCls } from '../../lib/ui'

export function NewOrderPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [showIssues, setShowIssues] = useState(false)
  const branch = useBranch()
  const can = useCan()
  const currency = branch?.baseCurrency ?? 'USD'
  const evaluation = evaluateDraft(draft, { maxDiscountPercent: branch?.maxDiscountPercent ?? null, mayOverrideDiscount: can('orders:discount:override') })
  const set = <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const delivery = draft.fulfillmentType === 'delivery'

  const issueText = (code: string, line?: number) => t(`issue.${code}`, { n: line, percent: branch?.maxDiscountPercent ?? 0 })

  async function save() {
    setShowIssues(true)
    if (evaluation.issues.length > 0) return
    setBusy(true)
    setFailure(null)
    try {
      const order = await createOrderLocally({ ...draftToInput(draft), currency })
      requestSync()
      navigate(`/orders/${order.id}`, { replace: true })
    } catch (err) {
      setFailure(err instanceof InvalidOrderError || err instanceof InvalidMutationError ? t('issue.generic') : t('common.error'))
      setBusy(false)
    }
  }

  const totals = evaluation.totals
  return (
    <section className="mx-auto max-w-2xl p-4 pb-6">
      <h1 className="text-2xl font-extrabold">{t('newOrder.title')}</h1>

      <div className="mt-4">
        <h2 className="mb-2 font-bold">{t('customer.title')}</h2>
        <CustomerPicker customerId={draft.customerId} onChange={(id) => set('customerId', id)} />
      </div>

      <div className={sectionCls}>
        <h2 className="mb-2 font-bold">{t('newOrder.items')}</h2>
        <LineEditor lines={draft.lines} lineTotals={totals?.lines} currency={currency} onChange={(lines) => set('lines', lines)} customerId={draft.customerId} />
      </div>

      <div className={sectionCls}>
        <h2 className="mb-2 font-bold">{t('newOrder.fulfillment')}</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('newOrder.fulfillment')}>
          {(['pickup', 'delivery'] as const).map((kind) => (
            <button key={kind} type="button" role="radio" aria-checked={draft.fulfillmentType === kind} onClick={() => set('fulfillmentType', kind)}
              className={`border border-ink py-3 font-semibold ${draft.fulfillmentType === kind ? 'bg-ink text-white' : ''}`}>{t(`newOrder.${kind}`)}</button>
          ))}
        </div>
        {delivery && (
          <div className="mt-3 flex flex-col gap-3">
            <label className={labelCls}>{t('newOrder.address')}<input className={inputCls} value={draft.deliveryAddress} onChange={(e) => set('deliveryAddress', e.target.value)} /></label>
            <label className={labelCls}>{t('newOrder.city')}<input className={inputCls} value={draft.deliveryCity} onChange={(e) => set('deliveryCity', e.target.value)} /></label>
            <label className={labelCls}>{t('newOrder.deliveryNotes')}<input className={inputCls} value={draft.deliveryNotes} onChange={(e) => set('deliveryNotes', e.target.value)} /></label>
            <label className={labelCls}>{t('newOrder.deliveryFee')}<input className={inputCls} dir="ltr" inputMode="decimal" value={draft.deliveryFee} onChange={(e) => set('deliveryFee', cleanDecimal(e.target.value))} /></label>
          </div>
        )}
      </div>

      <div className={sectionCls}>
        <h2 className="mb-2 font-bold">{t('newOrder.paymentAndNotes')}</h2>
        <div className="flex flex-col gap-3">
          <label className={labelCls}>{t('newOrder.method')}
            <select className={inputCls} value={draft.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as OrderDraft['paymentMethod'])}>
              <option value="cod">{t('method.cod')}</option>
              <option value="cash">{t('method.cash')}</option>
              <option value="whish_money">{t('method.whish_money')}</option>
            </select>
          </label>
          <label className={labelCls}>{t('newOrder.discountTotal')}<input className={inputCls} dir="ltr" inputMode="decimal" value={draft.discountTotal} onChange={(e) => set('discountTotal', cleanDecimal(e.target.value))} /></label>
          <label className={labelCls}>{t('newOrder.dueDate')}<input className={inputCls} type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></label>
          <label className={labelCls}>{t('newOrder.customerNotes')}<textarea className={inputCls} rows={2} value={draft.customerNotes} onChange={(e) => set('customerNotes', e.target.value)} /></label>
          <label className={labelCls}>{t('newOrder.internalNotes')}<textarea className={inputCls} rows={2} value={draft.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} /></label>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-ink bg-white p-4">
        {showIssues && evaluation.issues.length > 0 && (
          <ul role="alert" className="mb-3 list-disc ps-5 text-sm font-semibold text-magenta">
            {evaluation.issues.map((issue, i) => <li key={`${issue.code}-${issue.line ?? ''}-${i}`}>{issueText(issue.code, issue.line)}</li>)}
          </ul>
        )}
        {failure && <p role="alert" className="mb-3 text-sm font-semibold text-magenta">{failure}</p>}
        <dl className="mb-3 grid grid-cols-[1fr_auto] gap-x-4 text-sm" dir="auto">
          {totals && Number(totals.discountTotal) > 0 && (<><dt className="text-muted">{t('newOrder.discountTotal')}</dt><dd dir="ltr">−{money(totals.discountTotal, currency)}</dd></>)}
          {totals && delivery && Number(totals.deliveryFee) > 0 && (<><dt className="text-muted">{t('newOrder.deliveryFee')}</dt><dd dir="ltr">{money(totals.deliveryFee, currency)}</dd></>)}
          <dt className="text-lg font-extrabold">{t('newOrder.total')}</dt>
          <dd className="text-lg font-extrabold" dir="ltr">{totals ? money(totals.total, currency) : '—'}</dd>
        </dl>
        <div className="flex gap-2">
          <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{busy ? t('newOrder.saving') : t('newOrder.save')}</button>
          <button type="button" className={ghostBtn} onClick={() => navigate(-1)}>{t('common.cancel')}</button>
        </div>
      </div>
    </section>
  )
}
