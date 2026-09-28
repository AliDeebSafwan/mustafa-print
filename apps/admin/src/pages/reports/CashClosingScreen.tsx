import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CsvDownloadButton, DatePicker } from '../../components/reports/report-controls'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { reportsApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { useBranch } from '../../auth'
import { dateTime, money } from '../../lib/format'

const todayIso = () => new Date().toISOString().slice(0, 10)

export function CashClosingScreen() {
  const { t, i18n } = useTranslation()
  const currency = useBranch()?.baseCurrency ?? 'USD'
  const [date, setDate] = useState(todayIso())
  const load = useCallback(() => reportsApi.cashClosing(date), [date])
  const { data, error } = useResource(load)

  const net = data ? data.byMethod.reduce((sum, m) => sum + (m.txn_type === 'refund' ? -1 : 1) * Number(m.amount), 0) : 0

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DatePicker date={date} onChange={setDate} />
        <CsvDownloadButton path={`/cash-closing?date=${date}`} filename={`cash-closing-${date}.csv`} />
      </div>
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      {data && (
        <>
          <p className="mt-4 text-sm text-muted">{t('reports.netCollected')}</p>
          <p className="text-2xl font-extrabold" dir="ltr">{money(net, currency)}</p>

          {data.byMethod.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead><tr className="border-b border-ink text-start">
                <th className="py-1.5 text-start font-bold">{t('reports.method')}</th>
                <th className="py-1.5 text-start font-bold">{t('reports.type')}</th>
                <th className="py-1.5 text-end font-bold">{t('reports.count')}</th>
                <th className="py-1.5 text-end font-bold">{t('reports.amount')}</th>
              </tr></thead>
              <tbody>
                {data.byMethod.map((m, i) => (
                  <tr key={i} className="border-b border-rule">
                    <td className="py-1.5">{t(`method.${m.method}`, { defaultValue: m.method })}</td>
                    <td className="py-1.5">{t(`reports.txnType.${m.txn_type}`, { defaultValue: m.txn_type })}</td>
                    <td className="py-1.5 text-end" dir="ltr">{m.count}</td>
                    <td className="py-1.5 text-end font-semibold" dir="ltr">{money(m.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 className="mt-6 mb-2 font-bold">{t('reports.entries')}</h2>
          {data.entries.length === 0 ? <p className="text-muted">{t('reports.noEntries')}</p> : (
            <ul className="divide-y divide-rule border-y border-rule text-sm">
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{e.customer_name} · {e.order_number ? `#${e.order_number}` : e.public_code}</p>
                    <p className="text-xs text-muted">{dateTime(e.till_at, i18n.language)}{e.handled_by_name ? ` · ${e.handled_by_name}` : ''}</p>
                  </div>
                  <p className={`shrink-0 font-bold ${e.txn_type === 'refund' ? 'text-magenta' : ''}`} dir="ltr">{e.txn_type === 'refund' ? '−' : ''}{money(e.amount, currency)}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
