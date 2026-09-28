import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ORDER_STATUS_LABELS, isOrderStatus } from '@mpe/shared'
import { CsvDownloadButton } from '../../components/reports/report-controls'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { reportsApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { asLocale, dateTime } from '../../lib/format'

export function ProductionQueueScreen() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const load = useCallback(() => reportsApi.productionQueue(), [])
  const { data, error } = useResource(load)
  // Computed once per visit to the screen, not on every render: "reload the page to see freshly-overdue orders"
  // is an entirely acceptable trade-off for a report, and reading the clock directly in the render body is impure.
  const [now] = useState(() => Date.now())

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('reports.queueCount', { count: data?.length ?? 0 })}</p>
        <CsvDownloadButton path="/production-queue" filename="production-queue.csv" />
      </div>
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      {data && data.length === 0 && <p className="mt-4 text-muted">{t('reports.queueEmpty')}</p>}
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {data?.map((row) => {
          const overdue = Boolean(row.due_at && new Date(row.due_at).getTime() < now)
          return (
            <li key={row.id}>
              <Link to={`/orders/${row.id}`} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-bold">{row.customer_name}</p>
                  <p className="text-xs text-muted">
                    {row.order_number ? `#${row.order_number}` : row.public_code} · {isOrderStatus(row.status) ? ORDER_STATUS_LABELS[row.status][lang] : row.status}
                  </p>
                </div>
                {row.due_at && <p className={`shrink-0 text-xs font-bold ${overdue ? 'text-magenta' : 'text-muted'}`}>{dateTime(row.due_at, i18n.language)}</p>}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
