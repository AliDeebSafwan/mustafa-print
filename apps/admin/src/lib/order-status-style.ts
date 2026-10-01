import { Hourglass, Inbox, PackageCheck, PenTool, Printer, Scissors, Truck, UserCheck, type LucideIcon } from 'lucide-react'
import { ORDER_STATUSES, TERMINAL_STATUSES, type OrderStatus } from '@mpe/shared'

/** The statuses an order moves through on the shop floor, in pipeline order: every status except the two endings. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s))

/**
 * How each status is drawn: a colour for its light (`text-*`, read through currentColor) and an icon. The colour is only
 * ever used on the light or icon, never on the status name itself, so the label keeps full contrast in both themes and
 * the state never depends on colour alone.
 */
export const STATUS_STYLE: Record<OrderStatus, { tone: string; icon: LucideIcon }> = {
  pending: { tone: 'text-warn', icon: Hourglass },             // needs a person to confirm it
  received: { tone: 'text-muted', icon: Inbox },
  in_design: { tone: 'text-violet', icon: PenTool },
  awaiting_approval: { tone: 'text-yellow', icon: UserCheck }, // waiting on the customer, not on the shop
  printing: { tone: 'text-cyan', icon: Printer },
  finishing: { tone: 'text-cyan', icon: Scissors },
  ready: { tone: 'text-ok', icon: PackageCheck },
  out_for_delivery: { tone: 'text-ok', icon: Truck },
  delivered: { tone: 'text-ok', icon: PackageCheck },
  cancelled: { tone: 'text-magenta', icon: Inbox },
}

/** Machines are running for these: their lights pulse while orders sit in them. */
export const LIVE_STATUSES: readonly OrderStatus[] = ['printing', 'finishing']

export const isOverdue = (dueAt: string | null | undefined, now: number): boolean =>
  Boolean(dueAt && new Date(dueAt).getTime() < now)
