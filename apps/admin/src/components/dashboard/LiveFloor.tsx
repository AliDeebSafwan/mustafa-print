import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@mpe/shared'
import { db } from '../../offline/db'
import { asLocale } from '../../lib/format'
import { ACTIVE_STATUSES, LIVE_STATUSES, STATUS_STYLE, isOverdue } from '../../lib/order-status-style'
import { cn } from '../../lib/cn'

/**
 * Where every open order is right now, one light per stage of the pipeline. Read from this device's copy of the
 * orders, so it works without a connection and moves the moment anyone changes a status here.
 */
export function LiveFloor() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  // The clock is read once per visit, like the production queue: an order turning overdue mid-visit can wait for the next.
  const [now] = useState(() => Date.now())
  const floor = useLiveQuery(async () => {
    const counts = Object.fromEntries(ACTIVE_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>
    let overdue = 0
    for (const o of await db.orders.toArray()) {
      if (!(o.status in counts)) continue
      counts[o.status as OrderStatus] += 1
      if (isOverdue(o.due_at, now)) overdue += 1
    }
    return { counts, overdue, active: Object.values(counts).reduce((a, b) => a + b, 0) }
  }, [now])

  return (
    <section className="panel p-3" aria-labelledby="live-floor-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="live-floor-title" className="flex items-center gap-2 text-sm font-bold">
          <span aria-hidden className="status-dot live text-ok" />
          {t('reports.liveFloor')}
        </h2>
        <Link to="/?view=board" className="text-sm font-semibold underline">{t('reports.openBoard')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      </div>
      <p className="mt-1 text-xs text-muted">
        <span>{t('reports.activeOrders', { count: floor?.active ?? 0 })}</span>
        {floor && floor.overdue > 0 && <> · <span className="font-bold text-magenta">{t('reports.overdueOrders', { count: floor.overdue })}</span></>}
      </p>
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIVE_STATUSES.map((status) => {
          const { tone, icon: Icon } = STATUS_STYLE[status]
          const count = floor?.counts[status] ?? 0
          return (
            <li key={status} className={cn('flex items-center justify-between gap-2 rounded-lg border border-rule px-2.5 py-2', count === 0 && 'opacity-60')}>
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                <span aria-hidden className={cn('status-dot', tone, count > 0 && LIVE_STATUSES.includes(status) && 'live')} />
                <Icon aria-hidden className={cn('size-3.5 shrink-0', tone)} />
                <span className="truncate">{ORDER_STATUS_LABELS[status][lang]}</span>
              </span>
              <span className="num-col text-base font-extrabold">{count}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
