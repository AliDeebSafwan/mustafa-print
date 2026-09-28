import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DatePicker } from '../../components/reports/report-controls'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { reportsApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { useBranch } from '../../auth'
import { money } from '../../lib/format'

const todayIso = () => new Date().toISOString().slice(0, 10)

export function DashboardScreen() {
  const { t } = useTranslation()
  const currency = useBranch()?.baseCurrency ?? 'USD'
  const [date, setDate] = useState(todayIso())
  const load = useCallback(() => reportsApi.dashboard(date), [date])
  const { data, error } = useResource(load)

  const cards = data ? [
    { label: t('reports.ordersPlaced'), value: String(data.ordersPlaced) },
    { label: t('reports.revenuePlaced'), value: money(data.revenuePlaced, currency) },
    { label: t('reports.ordersCompleted'), value: String(data.ordersCompleted) },
    { label: t('reports.cashIn'), value: money(data.cashIn, currency) },
    { label: t('reports.cashOut'), value: money(data.cashOut, currency) },
    { label: t('reports.ordersDueToday'), value: String(data.ordersDueToday) },
  ] : []

  return (
    <div>
      <DatePicker date={date} onChange={setDate} />
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      {data && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="border border-rule p-3">
              <p className="text-xs text-muted">{c.label}</p>
              <p className="mt-1 text-xl font-extrabold" dir="ltr">{c.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
