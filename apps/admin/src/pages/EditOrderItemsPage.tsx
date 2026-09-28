import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useBranch, useCan } from '../auth'
import { LineEditor } from '../components/order/LineEditor'
import { editOrderItemsLocally, InvalidMutationError, InvalidOrderError, itemsEditIsLocked } from '../offline/actions'
import { db } from '../offline/db'
import { cleanDecimal, evaluateItemsEdit, newLine, type DraftLine } from '../offline/order-draft'
import { requestSync } from '../offline/request-sync'
import { money } from '../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn, sectionCls } from '../lib/ui'

export function EditOrderItemsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const branch = useBranch()
  const can = useCan()

  const data = useLiveQuery(async () => {
    const order = await db.orders.get(id)
    if (!order) return { order: undefined }
    const items = await db.order_items.where('order_id').equals(id).sortBy('sort_order')
    return { order, items }
  }, [id])

  const [lines, setLines] = useState<DraftLine[] | null>(null)
  const [discountTotal, setDiscountTotal] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [showIssues, setShowIssues] = useState(false)

  // Seeded once, from the order's items as they stood when this screen opened — never again, so a live-query
  // refresh (from this same edit, or anything else touching the order) does not clobber what is being typed.
  useEffect(() => {
    if (lines !== null || !data?.order) return
    setLines(data.items && data.items.length ? data.items.map((i) => newLine({ name: i.name_snapshot, quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount ?? '', productId: i.product_id ?? undefined })) : [newLine()])
    setDiscountTotal(String(data.order.discount_total ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately seeds once; data itself must stay out of the deps
  }, [data?.order, lines])

  if (!data?.order || lines === null || discountTotal === null) return null
  const { order } = data

  const currency = order.currency
  const locked = itemsEditIsLocked(order)
  const mayOverride = can('orders:items:override')
  const evaluation = evaluateItemsEdit(lines, discountTotal ?? '', order.delivery_fee ?? '0', { maxDiscountPercent: branch?.maxDiscountPercent ?? null, mayOverrideDiscount: can('orders:discount:override') })
  const issueText = (code: string, line?: number) => t(`issue.${code}`, { n: line, percent: branch?.maxDiscountPercent ?? 0 })

  async function save() {
    setShowIssues(true)
    if (evaluation.issues.length > 0) return
    if (locked && !reason.trim()) return
    setBusy(true)
    setFailure(null)
    try {
      await editOrderItemsLocally(order!, {
        items: evaluation.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, ...(l.discount.trim() ? { discount: l.discount } : {}), ...(l.productId ? { productId: l.productId } : {}) })),
        discountTotal: discountTotal!.trim() || undefined,
        overrideReason: locked ? reason.trim() : undefined,
      })
      requestSync()
      navigate(`/orders/${order!.id}`, { replace: true })
    } catch (err) {
      setFailure(err instanceof InvalidOrderError || err instanceof InvalidMutationError ? t('issue.generic') : t('common.error'))
      setBusy(false)
    }
  }

  const totals = evaluation.totals
  return (
    <section className="mx-auto max-w-2xl p-4 pb-6">
      <h1 className="text-2xl font-extrabold">{t('editItems.title')}</h1>

      {locked && (
        <div className="mt-3 border-s-4 border-magenta bg-tint p-3 text-sm">
          <p className="font-semibold">{t('editItems.locked')}</p>
          {!mayOverride ? (
            <p className="mt-1 text-muted">{t('editItems.lockedNoPermission')}</p>
          ) : (
            <label className={`${labelCls} mt-2`}>{t('editItems.reason')}
              <textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('editItems.reasonPlaceholder')} />
            </label>
          )}
        </div>
      )}

      {(!locked || mayOverride) && (
        <>
          <div className={sectionCls}>
            <h2 className="mb-2 font-bold">{t('newOrder.items')}</h2>
            <LineEditor lines={lines} lineTotals={totals?.lines} currency={currency} onChange={setLines} customerId={order.customer_id} />
          </div>

          <div className={sectionCls}>
            <label className={labelCls}>{t('newOrder.discountTotal')}
              <input className={inputCls} dir="ltr" inputMode="decimal" value={discountTotal ?? ''} onChange={(e) => setDiscountTotal(cleanDecimal(e.target.value))} />
            </label>
          </div>

          <div className="sticky bottom-0 -mx-4 mt-6 border-t border-ink bg-white p-4">
            {showIssues && evaluation.issues.length > 0 && (
              <ul role="alert" className="mb-3 list-disc ps-5 text-sm font-semibold text-magenta">
                {evaluation.issues.map((issue, i) => <li key={`${issue.code}-${issue.line ?? ''}-${i}`}>{issueText(issue.code, issue.line)}</li>)}
              </ul>
            )}
            {showIssues && locked && !reason.trim() && <p role="alert" className="mb-3 text-sm font-semibold text-magenta">{t('editItems.needReason')}</p>}
            {failure && <p role="alert" className="mb-3 text-sm font-semibold text-magenta">{failure}</p>}
            <dl className="mb-3 grid grid-cols-[1fr_auto] gap-x-4 text-sm" dir="auto">
              {totals && Number(totals.discountTotal) > 0 && (<><dt className="text-muted">{t('newOrder.discountTotal')}</dt><dd dir="ltr">−{money(totals.discountTotal, currency)}</dd></>)}
              <dt className="text-lg font-extrabold">{t('newOrder.total')}</dt>
              <dd className="text-lg font-extrabold" dir="ltr">{totals ? money(totals.total, currency) : '—'}</dd>
            </dl>
            <div className="flex gap-2">
              <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{busy ? t('newOrder.saving') : t('newOrder.save')}</button>
              <button type="button" className={ghostBtn} onClick={() => navigate(-1)}>{t('common.cancel')}</button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
