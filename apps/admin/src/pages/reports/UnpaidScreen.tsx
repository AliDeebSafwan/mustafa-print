import { useCallback } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CsvDownloadButton } from '../../components/reports/report-controls'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { reportsApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { dateTime, money } from '../../lib/format'

export function UnpaidScreen() {
  const { t, i18n } = useTranslation()
  const load = useCallback(() => reportsApi.unpaid(), [])
  const { data, error } = useResource(load)
  const total = data?.reduce((sum, r) => sum + Number(r.remaining), 0) ?? 0

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('reports.unpaidCount', { count: data?.length ?? 0 })}</p>
        <CsvDownloadButton path="/unpaid" filename="unpaid-balances.csv" />
      </div>
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      {data && data.length === 0 && <p className="mt-4 text-muted">{t('reports.noUnpaid')}</p>}
      {data && data.length > 0 && (
        <>
          <p className="mt-2 text-lg font-extrabold" dir="ltr">{money(total, data[0]!.currency)}</p>
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {data.map((row) => (
              <li key={row.id}>
                <Link to={`/orders/${row.id}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-bold">{row.customer_name}</p>
                    <p className="text-xs text-muted">{row.order_number ? `#${row.order_number}` : row.public_code} · {dateTime(row.placed_at, i18n.language)}</p>
                  </div>
                  <p className="shrink-0 font-bold text-magenta" dir="ltr">{money(row.remaining, row.currency)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
