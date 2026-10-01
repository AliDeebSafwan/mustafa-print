import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Rows3 } from 'lucide-react'
import { ORDER_STATUS_LABELS, TERMINAL_STATUSES, isOrderStatus, roleDefinition, toWesternDigits } from '@mpe/shared'
import { useAuth, useCan } from '../../auth'
import { OrderBoard } from '../../components/orders/OrderBoard'
import { db } from '../../offline/db'
import { asLocale, money } from '../../lib/format'
import { inputCls, primaryBtn } from '../../lib/ui'
import { cn } from '../../lib/cn'

export function OrdersPage() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const can = useCan()
  const auth = useAuth()
  const role = auth.status === 'signed_in' ? roleDefinition(auth.user.role) : undefined
  // The view lives in the address (?view=board), so the back button, a bookmark and the dashboard's link all land on it.
  const [params, setParams] = useSearchParams()
  const board = params.get('view') === 'board'
  const setView = (next: 'list' | 'board') => setParams(next === 'board' ? { view: 'board' } : {}, { replace: true })
  const [query, setQuery] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [onlyWeb, setOnlyWeb] = useState(false)

  const rows = useLiveQuery(async () => {
    const [orders, customers] = await Promise.all([db.orders.toArray(), db.customers.toArray()])
    const byId = new Map(customers.map((c) => [c.id, c]))
    const text = toWesternDigits(query).trim().toLowerCase().replace(/^#/, '')
    const digits = text.replace(/\D/g, '')
    return orders
      .filter((o) => (showClosed && !board) || (text !== '' && !board) || !(TERMINAL_STATUSES as readonly string[]).includes(o.status))
      .filter((o) => !onlyWeb || o.source === 'web')
      .map((o) => ({ order: o, customer: byId.get(o.customer_id) }))
      .filter(({ order, customer }) => text === '' ||
        (order.order_number ?? '') === text || order.public_code.toLowerCase().includes(text) || (customer?.full_name ?? '').toLowerCase().includes(text) ||
        (digits.length >= 3 && (customer?.phone_e164 ?? '').includes(digits)))
      .sort((a, b) => (b.order.placed_at ?? '').localeCompare(a.order.placed_at ?? ''))
      .slice(0, 200)
  }, [query, showClosed, onlyWeb, board], [])

  return (
    <section className={cn('mx-auto p-4', board ? 'max-w-7xl' : 'max-w-3xl')}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('orders.title')}</h1>
        <div className="flex gap-2">
          {can('orders:read') && <Link to="/quotes" className="border border-ink px-3 py-2.5 font-semibold">{t('quotes.title')}</Link>}
          {can('orders:create') && <Link to="/orders/new" className={`${primaryBtn} py-2.5`}>{t('orders.new')}</Link>}
        </div>
      </div>
      <input className={`${inputCls} mt-4`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('orders.search')} aria-label={t('orders.search')} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div role="group" aria-label={t('orders.view')} className="flex overflow-hidden rounded-md border border-ink text-sm font-semibold">
          <button type="button" aria-pressed={!board} onClick={() => setView('list')} className={cn('flex min-h-11 items-center gap-1.5 px-3', !board && 'bg-ink text-white')}>
            <Rows3 aria-hidden className="size-4" />{t('orders.viewList')}
          </button>
          <button type="button" aria-pressed={board} onClick={() => setView('board')} className={cn('flex min-h-11 items-center gap-1.5 px-3', board && 'bg-ink text-white')}>
            <LayoutGrid aria-hidden className="size-4" />{t('orders.viewBoard')}
          </button>
        </div>
        {!board && <button type="button" className="text-muted underline" onClick={() => setShowClosed((v) => !v)}>{showClosed ? t('orders.hideClosed') : t('orders.showClosed')}</button>}
        <label className="flex items-center gap-1.5 font-semibold">
          <input type="checkbox" className="size-4" checked={onlyWeb} onChange={(e) => setOnlyWeb(e.target.checked)} />
          {t('orders.onlyWeb')}
        </label>
      </div>

      {board ? (
        <OrderBoard rows={rows} role={role} />
      ) : rows.length === 0 ? (
        <p className="mt-8 text-muted">{t('orders.empty')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-rule border-y border-rule">
          {rows.map(({ order: o, customer }) => (
            <li key={o.id}>
              <Link to={`/orders/${o.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-tint">
                <div className="min-w-0">
                  <p className="font-bold"><span dir="ltr">{o.order_number ? `#${o.order_number}` : o.public_code.slice(0, 6)}</span> <span className="font-semibold">{customer?.full_name}</span></p>
                  <p className="text-sm text-muted">
                    {isOrderStatus(o.status) ? ORDER_STATUS_LABELS[o.status][lang] : o.status}
                    {o.payment_status && o.payment_status !== 'unpaid' ? ` · ${t(`paymentStatus.${o.payment_status}`)}` : ''}
                    {o.source === 'web' ? ` · ${t('order.fromWebsite')}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="font-semibold" dir="ltr">{money(o.total, o.currency)}</p>
                  {o.delivery_fee_pending && <span className="text-xs font-bold text-magenta">{t('order.deliveryFee.needsPricing')}</span>}
                  {o.proof_status === 'approved' && o.status === 'awaiting_approval' && <span className="block text-xs font-bold text-ok">{t('proofs.listApproved')}</span>}
                  {o.proof_status === 'changes_requested' && <span className="block text-xs font-bold text-magenta">{t('proofs.listChanges')}</span>}
                  {o._rejected ? <span className="text-xs font-semibold text-magenta">{t('orders.rejected')}</span> : o._pending && <span className="text-xs font-semibold text-warn">{t('orders.local')}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
