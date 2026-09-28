import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ORDER_STATUS_LABELS, TERMINAL_STATUSES, allowedNextStatuses, formatCents, isOrderStatus, roleDefinition, toCents, toWesternDigits, type OrderStatus } from '@mpe/shared'
import { useAuth, useBranch, useCan } from '../auth'
import { CancelOrderDialog } from '../components/order/CancelOrderDialog'
import { DeliveryFeeForm } from '../components/order/DeliveryFeeForm'
import { MessagesSection } from '../components/order/MessagesSection'
import { OrderFiles } from '../components/order/OrderFiles'
import { ProofsSection } from '../components/order/ProofsSection'
import { PaymentForm } from '../components/order/PaymentForm'
import { changeOrderStatus } from '../offline/actions'
import { db } from '../offline/db'
import { requestSync } from '../offline/request-sync'
import { asLocale, dateTime, money, reasonText } from '../lib/format'
import { ghostBtn, sectionCls } from '../lib/ui'

export function OrderDetailPage() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const { id = '' } = useParams()
  const can = useCan()
  const [proofsOpen, setProofsOpen] = useState(false)
  const auth = useAuth()
  const branch = useBranch()
  const role = auth.status === 'signed_in' ? roleDefinition(auth.user.role) : undefined

  const data = useLiveQuery(async () => {
    const order = await db.orders.get(id)
    if (!order) return { order: undefined }
    const [customer, items, payments, history] = await Promise.all([
      db.customers.get(order.customer_id),
      db.order_items.where('order_id').equals(id).sortBy('sort_order'),
      db.transactions.where('order_id').equals(id).sortBy('collected_at'),
      db.order_status_history.where('order_id').equals(id).sortBy('occurred_at'),
    ])
    return { order, customer, items, payments, history }
  }, [id])

  if (!data) return <p role="status" className="p-4 text-muted">{t('login.loading')}</p>
  const { order, customer, items = [], payments = [], history = [] } = data
  if (!order) return <section className="p-4"><p>{t('order.notFound')}</p><Link className="mt-3 inline-block underline" to="/">{t('order.back')}</Link></section>

  const totalCents = toCents(order.total) ?? 0
  const paidCents = toCents(order.paid_total ?? '0') ?? 0
  const remaining = Math.max(0, totalCents - paidCents)
  // The same rule the server enforces before printing: a percent of the total, only once the total reaches an
  // optional threshold. Shown here so staff know before they even try, not just when the server refuses.
  const depositPercent = Number(branch?.depositPercent ?? 0)
  const depositThreshold = branch?.depositThreshold
  const depositApplies = depositPercent > 0 && (depositThreshold === null || depositThreshold === undefined || totalCents / 100 >= depositThreshold)
  const depositOwedCents = depositApplies ? Math.max(0, Math.round((totalCents * depositPercent) / 100) - paidCents) : 0
  const beforePrinting = (['pending', 'received', 'in_design', 'awaiting_approval'] as readonly string[]).includes(order.status)
  const closed = (TERMINAL_STATUSES as readonly string[]).includes(order.status)
  const designStage = ['received', 'in_design', 'awaiting_approval'].includes(order.status)
  // Cancelling has its own button below: it always asks for a reason.
  const next = (role && isOrderStatus(order.status) ? allowedNextStatuses(role, order.status) : []).filter((s) => s !== 'cancelled')
  const mayCancel = can('orders:cancel') && !closed
  const phoneDigits = customer?.phone_e164 ? toWesternDigits(customer.phone_e164).replace(/\D/g, '') : ''

  async function move(to: OrderStatus) {
    if (!order) return
    await changeOrderStatus(order, to, { source: 'manual' })
    requestSync()
  }

  return (
    <section className="mx-auto max-w-2xl p-4 pb-8">
      <Link to="/" className="text-sm text-muted underline"><span className="arrow-back" aria-hidden="true">←</span> {t('order.back')}</Link>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" dir="ltr">{order.order_number ? `#${order.order_number}` : order.public_code.slice(0, 6)}</h1>
          <p className="text-sm text-muted">{dateTime(order.placed_at, lang)}{order.source === 'web' ? ` · ${t('order.fromWebsite')}` : ''}</p>
        </div>
        <span className="border border-ink px-3 py-1 font-bold">{isOrderStatus(order.status) ? ORDER_STATUS_LABELS[order.status][lang] : order.status}</span>
      </div>

      {order.status === 'cancelled' && order.cancel_reason ? <p className="mt-3 border-s-4 border-magenta bg-tint p-3 text-sm"><span className="font-semibold">{t('order.cancelledBecause')}:</span> {String(order.cancel_reason)}</p> : null}
      {/* delivery_fee is 0 while pending, so the order's current total is exactly the base to add the fee to */}
      {order.delivery_fee_pending && can('orders:delivery_fee:set') && (
        <div className="mt-3"><DeliveryFeeForm orderId={order.id} currency={order.currency} subtotalBeforeFee={order.total} onSet={requestSync} /></div>
      )}
      {order.delivery_fee_pending && !can('orders:delivery_fee:set') && (
        <p role="alert" className="mt-3 border-s-4 border-magenta bg-tint p-3 text-sm font-semibold">{t('order.deliveryFee.waitingForOwner')}</p>
      )}
      {beforePrinting && depositOwedCents > 0 && (
        <p role="alert" className="mt-3 border-s-4 border-magenta bg-tint p-3 text-sm font-semibold">
          {t('order.depositOwed', { amount: money(formatCents(depositOwedCents), order.currency) })}
        </p>
      )}
      {order._rejected && <p role="alert" className="mt-3 border-s-4 border-magenta bg-tint p-3 text-sm font-semibold">{t('order.rejected', { reason: reasonText(t, order._rejected) })}</p>}
      {order._pending && !order._rejected && <p className="mt-3 text-sm font-semibold text-warn">{t('order.notSynced')}</p>}

      <div className={sectionCls}>
        <h2 className="mb-2 font-bold">{t('customer.title')}</h2>
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">{customer?.full_name ?? '—'}</p>
          {customer && can('customers:write') && <Link to={`/customers/${customer.id}/edit`} className="border border-ink px-3 py-1.5 text-sm font-semibold">{t('common.edit')}</Link>}
        </div>
        {customer?.phone_e164 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted" dir="ltr">{customer.phone_e164}</span>
            <a className="border border-ink px-3 py-1.5 text-sm font-semibold" href={`tel:${customer.phone_e164}`}>{t('order.call')}</a>
            <a className="border border-ink px-3 py-1.5 text-sm font-semibold" href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">{t('order.whatsapp')}</a>
          </div>
        )}
        {order.fulfillment_type === 'delivery' && <p className="mt-3 text-sm"><span className="font-semibold">{t('order.deliverTo')}:</span> {[order.delivery_address, order.delivery_city].filter(Boolean).join('، ')}{order.delivery_notes ? ` (${order.delivery_notes})` : ''}</p>}
        {order.due_at && <p className="mt-1 text-sm"><span className="font-semibold">{t('order.due')}:</span> {dateTime(order.due_at, lang)}</p>}
        {order.customer_notes && <p className="mt-1 text-sm">{order.customer_notes}</p>}
        {order.internal_notes && <p className="mt-1 text-sm text-muted">{order.internal_notes}</p>}
      </div>

      {next.length > 0 && (
        <div className={sectionCls}>
          <h2 className="mb-2 font-bold">{t('order.moveTo')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {next.map((s) => <button key={s} className={`${ghostBtn} py-3`} onClick={() => void move(s)}>{ORDER_STATUS_LABELS[s][lang]}</button>)}
          </div>
        </div>
      )}

      <div className={sectionCls}>
        <h2 className="mb-2 font-bold">{t('order.items')}</h2>
        <ul className="divide-y divide-rule border-y border-rule">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
              <div><p className="font-semibold">{item.name_snapshot}</p><p className="text-sm text-muted" dir="ltr">{Number(item.quantity)} × {money(item.unit_price, '')}</p></div>
              <p className="font-semibold" dir="ltr">{money(item.line_total, '')}</p>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {Number(order.discount_total) > 0 && (<><dt className="text-muted">{t('newOrder.discountTotal')}</dt><dd dir="ltr">−{money(order.discount_total, order.currency)}</dd></>)}
          {Number(order.delivery_fee) > 0 && (<><dt className="text-muted">{t('newOrder.deliveryFee')}</dt><dd dir="ltr">{money(order.delivery_fee, order.currency)}</dd></>)}
          {Number(order.tax_total ?? 0) > 0 && (<><dt className="text-muted">{t('order.tax')}</dt><dd dir="ltr">{money(order.tax_total, order.currency)}</dd></>)}
          <dt className="text-lg font-extrabold">{t('newOrder.total')}</dt><dd className="text-lg font-extrabold" dir="ltr">{money(order.total, order.currency)}</dd>
          <dt className="text-muted">{t('order.paid')}</dt><dd dir="ltr">{money(order.paid_total, order.currency)} · {t(`paymentStatus.${order.payment_status ?? 'unpaid'}`)}</dd>
          {remaining > 0 && (<><dt className="font-semibold">{t('order.remaining')}</dt><dd className="font-bold" dir="ltr">{money(formatCents(remaining), order.currency)}</dd></>)}
        </dl>
      </div>

      <div className={sectionCls}>
        <h2 className="mb-2 font-bold">{t('order.payments')}</h2>
        {payments.length === 0 ? <p className="text-sm text-muted">{t('order.noPayments')}</p> : (
          <ul className="divide-y divide-rule border-y border-rule">
            {payments.map((p) => (
              <li key={p.id} className={`flex items-center justify-between gap-3 py-2.5 ${p._rejected ? 'opacity-60' : ''}`}>
                <div>
                  <p className="font-semibold">{t(`pay.type.${p.txn_type}`)} · {t(`method.${p.method}`, { defaultValue: p.method })}</p>
                  <p className="text-xs text-muted">{dateTime(p.collected_at, lang)}{p._pending ? ` · ${t('order.notSynced')}` : ''}{p._rejected ? ` · ${t('pay.rejected', { reason: reasonText(t, p._rejected) })}` : ''}</p>
                </div>
                <p className={`font-bold ${p.txn_type === 'refund' ? 'text-magenta' : ''}`} dir="ltr">{p.txn_type === 'refund' ? '−' : ''}{money(p.amount, '')}</p>
              </li>
            ))}
          </ul>
        )}
        {can('transactions:collect') && order.status !== 'cancelled' && <div className="mt-3"><PaymentForm key={`${order.id}-${order.paid_total}-${order.total}`} order={order} canRefund={can('transactions:refund')} /></div>}
      </div>

      {(can('orders:update') || mayCancel) && !closed && (
        <div className={`${sectionCls} flex flex-col gap-2`}>
          {can('orders:update') && <Link to={`/orders/${order.id}/edit`} className={`${ghostBtn} block text-center`}>{t('order.edit')}</Link>}
          {mayCancel && <CancelOrderDialog order={order} />}
        </div>
      )}

      {order.source === 'web' && (
        <div className={sectionCls}><OrderFiles orderId={order.id} /></div>
      )}

      {order.proof_status && (
        <p className={`mt-3 border-s-4 p-3 text-sm font-semibold ${order.proof_status === 'approved' ? 'border-ok' : 'border-magenta'} bg-tint`}>{t(`proofs.orderBanner.${order.proof_status}`)}</p>
      )}
      {/* Online only, so it opens on demand: an order that never had a proof makes no network call just by being viewed. */}
      {!closed && (order.proof_status || proofsOpen) && (
        <div className={sectionCls}><ProofsSection orderId={order.id} customerPhone={customer?.phone_e164 ?? null} canUpload={can('orders:update') && designStage} /></div>
      )}
      {!closed && !order.proof_status && !proofsOpen && designStage && can('orders:update') && (
        <div className={sectionCls}><button type="button" className={`${ghostBtn} w-full`} onClick={() => setProofsOpen(true)}>{t('proofs.open')}</button></div>
      )}

      {customer && can('notifications:send') && (
        <div className={sectionCls}><MessagesSection orderId={order.id} customer={customer} lang={lang} /></div>
      )}

      <div className={sectionCls}>
        <Link to={`/orders/${order.id}/label`} className={`${ghostBtn} block text-center`}>{t('order.label')}</Link>
        <Link to={`/orders/${order.id}/invoice`} className={`${ghostBtn} mt-2 block text-center`}>
          {order.invoice_number ? t('order.invoiceNumbered', { n: order.invoice_number }) : t('order.invoice')}
        </Link>
        {!closed && can('orders:update') && (
          <Link to={`/orders/${order.id}/edit-items`} className={`${ghostBtn} mt-2 block text-center`}>{t('editItems.link')}</Link>
        )}
      </div>

      {history.length > 0 && (
        <div className={sectionCls}>
          <h2 className="mb-2 font-bold">{t('order.timeline')}</h2>
          <ol className="flex flex-col gap-1.5 text-sm">
            {history.map((h) => <li key={h.id} className="flex justify-between gap-3"><span>{isOrderStatus(h.to_status) ? ORDER_STATUS_LABELS[h.to_status][lang] : h.to_status}</span><span className="text-muted">{dateTime(h.occurred_at, lang)}</span></li>)}
          </ol>
        </div>
      )}
    </section>
  )
}
