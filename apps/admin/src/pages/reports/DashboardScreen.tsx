import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banknote, CalendarClock, CheckCircle2, ShoppingBag, Wallet, ArrowUpRight } from 'lucide-react'
import { DatePicker } from '../../components/reports/report-controls'
import { LiveFloor } from '../../components/dashboard/LiveFloor'
import { MachinesSoon } from '../../components/dashboard/MachinesSoon'
import { StatTile, StatTileSkeleton, type Delta } from '../../components/dashboard/StatTile'
import { TrendChart } from '../../components/dashboard/TrendChart'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { reportsApi, type DashboardReport } from '../../content'
import { useResource } from '../../content/use-resource'
import { useBranch } from '../../auth'
import { cn } from '../../lib/cn'
import { money } from '../../lib/format'

const todayIso = () => new Date().toISOString().slice(0, 10)
const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const TREND_DAYS = 6                    // the days before the chosen one: a week in all

interface Day { date: string; report: DashboardReport }

export function DashboardScreen() {
  const { t } = useTranslation()
  const currency = useBranch()?.baseCurrency ?? 'USD'
  const [date, setDate] = useState(todayIso())

  // The chosen day comes first and on its own, exactly as before: the numbers people came for never wait on the trend.
  // Each answer is tagged with its date, so while a new day loads the old numbers stay on screen, dimmed, not blanked.
  const load = useCallback(() => reportsApi.dashboard(date).then((report): Day => ({ date, report })), [date])
  const { data, error } = useResource(load)
  // The week behind it, for the charts and the "vs the day before" changes. Loaded separately, so if it fails the
  // day's own numbers still show. There is no range endpoint, so this is one request per day.
  const loadTrend = useCallback(() => Promise.all(
    Array.from({ length: TREND_DAYS }, (_, i) => shiftDay(date, i - TREND_DAYS)).map((d) => reportsApi.dashboard(d).then((report): Day => ({ date: d, report }))),
  ).then((days) => ({ date, days })), [date])
  const trend = useResource(loadTrend)

  const report = data?.report
  const stale = Boolean(data && data.date !== date)
  const week = data && trend.data && trend.data.date === data.date ? [...trend.data.days, data] : null
  const before = week?.at(-2)?.report

  /** The change against the day before, signed, with the period named. Only once the day before has loaded. */
  const delta = (now: number, prev: number | undefined, show: (v: number) => string, upIsGood: boolean | null): Delta | undefined => {
    if (prev === undefined) return undefined
    const change = Math.round((now - prev) * 100) / 100
    // The signed value is wrapped in Unicode directional isolates (LRI … PDI): without them an Arabic sentence
    // reorders "+51.00 USD" into "USD 51.00+".
    return { change, upIsGood, text: change === 0 ? t('reports.sameAsDayBefore') : t('reports.vsDayBefore', { change: `\u2066${change > 0 ? '+' : '−'}${show(Math.abs(change))}\u2069` }) }
  }
  const asMoney = (v: number) => money(v, currency)

  const tiles = report ? [
    { icon: ShoppingBag, label: t('reports.ordersPlaced'), value: String(report.ordersPlaced), delta: delta(report.ordersPlaced, before?.ordersPlaced, String, true) },
    { icon: Banknote, label: t('reports.revenuePlaced'), value: money(report.revenuePlaced, currency), delta: delta(Number(report.revenuePlaced), before && Number(before.revenuePlaced), asMoney, true) },
    { icon: CheckCircle2, label: t('reports.ordersCompleted'), value: String(report.ordersCompleted), delta: delta(report.ordersCompleted, before?.ordersCompleted, String, true) },
    { icon: Wallet, label: t('reports.cashIn'), value: money(report.cashIn, currency), delta: delta(Number(report.cashIn), before && Number(before.cashIn), asMoney, true) },
    // Money paid out is neither good nor bad by itself: its change is shown, in a neutral colour.
    { icon: ArrowUpRight, label: t('reports.cashOut'), value: money(report.cashOut, currency), delta: delta(Number(report.cashOut), before && Number(before.cashOut), asMoney, null) },
    { icon: CalendarClock, label: t('reports.ordersDueToday'), value: String(report.ordersDueToday) },
  ] : []

  return (
    <div className="flex flex-col gap-4">
      <DatePicker date={date} onChange={setDate} />
      <ContentErrorMessage error={error} />

      {report ? (
        <ul aria-label={t('reports.dayFigures')} className={cn('grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3', stale && 'opacity-50')}>
          {tiles.map((tile) => <StatTile key={tile.label} {...tile} />)}
        </ul>
      ) : !error && (
        <ul aria-busy="true" aria-label={t('reports.dayFigures')} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <StatTileSkeleton key={i} />)}
        </ul>
      )}

      {week ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TrendChart kind="columns" title={t('reports.trendOrders')} points={week.map((d) => ({ date: d.date, value: d.report.ordersPlaced }))} format={String} stale={stale} />
          <TrendChart kind="line" title={t('reports.trendRevenue')} points={week.map((d) => ({ date: d.date, value: Number(d.report.revenuePlaced) }))} format={asMoney} stale={stale} />
        </div>
      ) : trend.error && !error && <p className="text-sm text-muted">{t('reports.trendUnavailable')}</p>}

      <LiveFloor />
      <MachinesSoon />
    </div>
  )
}
