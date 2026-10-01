import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * How a number moved against the day before. `upIsGood` decides the colour: null for numbers where up is neither
 * good nor bad (money paid out), which stay neutral. The arrow and the signed text carry the direction too, so it
 * never rests on colour alone.
 */
export interface Delta { change: number; text: string; upIsGood: boolean | null }

export function StatTile({ icon: Icon, label, value, delta }: { icon: LucideIcon; label: string; value: string; delta?: Delta }) {
  const tone = !delta || delta.change === 0 || delta.upIsGood === null ? 'text-muted' : (delta.change > 0) === delta.upIsGood ? 'text-ok' : 'text-magenta'
  const Arrow = !delta || delta.change === 0 ? Minus : delta.change > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <li className="panel panel-lift flex flex-col gap-1 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Icon aria-hidden className="size-4 shrink-0 text-cyan" strokeWidth={2} />
        {label}
      </p>
      <p className="glow-text text-xl font-extrabold sm:text-2xl" dir="ltr">{value}</p>
      {delta && (
        <p className={cn('flex items-center gap-1 text-xs font-semibold', tone)}>
          <Arrow aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
          <span>{delta.text}</span>
        </p>
      )}
    </li>
  )
}

/** A tile-shaped placeholder for the first load only (a refetch keeps the old tiles, dimmed). */
export function StatTileSkeleton() {
  return (
    <li className="panel flex flex-col gap-2 p-3" aria-hidden>
      <span className="skeleton block h-3 w-2/3 rounded" />
      <span className="skeleton block h-6 w-1/2 rounded" />
    </li>
  )
}
