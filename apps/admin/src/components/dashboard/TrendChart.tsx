import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

export interface TrendPoint { date: string; value: number }

const H = 150
const PAD = { top: 18, right: 8, bottom: 20, left: 34 }
const MAX_BAR = 24                      // a column never fills its slot: the leftover is air
const R = 4                             // rounded data-end, square at the baseline

/** A clean axis maximum (1, 2, 2.5, 5 × 10ⁿ) at or above the largest value, so ticks land on round numbers. */
function niceMax(max: number): number {
  if (max <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(max))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= max) ?? 10) * p
}

const tick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/** A column whose top corners are rounded and whose foot sits square on the baseline. */
function columnPath(x: number, y: number, w: number, base: number): string {
  const r = Math.min(R, w / 2, base - y)
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`
}

/**
 * One measure over the days up to the chosen one: columns for counts, a line for money. A single series, so there is
 * no legend box: the title says what is plotted. Every value is reachable three ways: the hover/focus tooltip, the
 * direct label on the chosen day, and the table view. Time runs left to right in both languages, like the numbers.
 */
export function TrendChart({ title, points, kind, format, stale }: {
  title: string; points: TrendPoint[]; kind: 'columns' | 'line'; format: (v: number) => string; stale?: boolean
}) {
  const { t, i18n } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [active, setActive] = useState<number | null>(null)
  const tableId = useId()

  // Draw in real pixels so the column cap and line weight hold at every screen width (no viewBox stretching).
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width))) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const day = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en', { day: 'numeric', timeZone: 'UTC' })
  const full = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const when = (iso: string) => new Date(`${iso}T00:00:00Z`)

  const top = niceMax(Math.max(...points.map((p) => p.value), 0))
  const plotW = width - PAD.left - PAD.right
  const base = H - PAD.bottom
  const band = plotW / Math.max(points.length, 1)
  const xMid = (i: number) => PAD.left + band * i + band / 2
  const y = (v: number) => base - (v / top) * (base - PAD.top)
  const barW = Math.min(MAX_BAR, band * 0.6)
  const last = points.length - 1
  const ticks = [0, top / 2, top]

  const linePts = points.map((p, i) => `${xMid(i)},${y(p.value)}`).join(' ')
  const areaPath = points.length ? `M${xMid(0)},${base}L${linePts.replaceAll(' ', 'L')}L${xMid(last)},${base}Z` : ''

  return (
    <figure className="panel p-3">
      <figcaption className="text-sm font-bold">{title}</figcaption>
      <div ref={box} dir="ltr" className={cn('relative mt-2 transition-opacity', stale && 'opacity-50')}>
        <svg width={width} height={H} role="group" aria-label={title} className="block max-w-full overflow-visible">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="num-col fill-muted text-[10px]">{tick(v)}</text>
            </g>
          ))}

          {kind === 'columns' && points.map((p, i) => p.value > 0 && (
            <path key={p.date} d={columnPath(xMid(i) - barW / 2, y(p.value), barW, base)} fill="var(--chart-1)"
              opacity={i === last || i === active ? 1 : 0.45} />
          ))}

          {kind === 'line' && points.length > 0 && (
            <>
              <path d={areaPath} fill="var(--chart-2)" opacity={0.1} />
              <polyline points={linePts} fill="none" stroke="var(--chart-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {active !== null && <line x1={xMid(active)} x2={xMid(active)} y1={PAD.top} y2={base} stroke="var(--muted)" strokeWidth={1} />}
              {[last, ...(active !== null && active !== last ? [active] : [])].map((i) => (
                <circle key={i} cx={xMid(i)} cy={y(points[i]!.value)} r={4} fill="var(--chart-2)" stroke="var(--chart-surface)" strokeWidth={2} />
              ))}
            </>
          )}

          {/* Direct label on the chosen day only: never a number on every point. */}
          {points.length > 0 && (
            <text x={xMid(last)} y={y(points[last]!.value) - 7} textAnchor="middle" className="fill-ink text-[11px] font-bold">{format(points[last]!.value)}</text>
          )}

          {points.map((p, i) => (
            <text key={p.date} x={xMid(i)} y={H - 5} textAnchor="middle" className={cn('num-col text-[10px]', i === last ? 'fill-ink font-bold' : 'fill-muted')}>{day.format(when(p.date))}</text>
          ))}

          {/* Hit targets: the whole day column, bigger than any mark, reachable by keyboard as well as pointer. */}
          {points.map((p, i) => (
            <rect key={p.date} x={PAD.left + band * i} y={PAD.top - 8} width={band} height={base - PAD.top + 8} fill="transparent"
              tabIndex={0} role="img" aria-label={`${full.format(when(p.date))}: ${format(p.value)}`} className="cursor-default"
              onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
          ))}
        </svg>

        {active !== null && points[active] && (
          <div role="tooltip" className="panel pointer-events-none absolute z-10 -translate-x-1/2 px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(xMid(active), 60), width - 60), top: 0 }}>
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
              <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: kind === 'columns' ? 'var(--chart-1)' : 'var(--chart-2)' }} />
              {format(points[active].value)}
            </p>
            <p className="text-muted">{full.format(when(points[active].date))}</p>
          </div>
        )}
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-semibold text-muted" aria-controls={tableId}>{t('reports.viewTable')}</summary>
        <table id={tableId} className="mt-2 w-full text-start">
          <thead><tr className="text-xs text-muted"><th className="py-1 text-start font-semibold">{t('reports.date')}</th><th className="py-1 text-end font-semibold">{title}</th></tr></thead>
          <tbody className="divide-y divide-rule">
            {points.map((p) => (
              <tr key={p.date}><td className="py-1">{full.format(when(p.date))}</td><td className="num-col py-1 text-end" dir="ltr">{format(p.value)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
