import { useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CloudOff, Clock, Globe, TriangleAlert } from 'lucide-react'
import { ORDER_STATUS_LABELS, allowedNextStatuses, isOrderStatus, type OrderStatus, type RoleDefinition } from '@mpe/shared'
import { changeOrderStatus } from '../../offline/actions'
import type { CustomerRow, OrderRow } from '../../offline/db'
import { requestSync } from '../../offline/request-sync'
import { asLocale, dateTime, money } from '../../lib/format'
import { ACTIVE_STATUSES, LIVE_STATUSES, STATUS_STYLE, isOverdue } from '../../lib/order-status-style'
import { cn } from '../../lib/cn'

export interface BoardRow { order: OrderRow; customer?: CustomerRow }

/** Soonest due first; orders with no due date after them, oldest placed first. */
const byUrgency = (a: BoardRow, b: BoardRow) =>
  (a.order.due_at ?? '￿').localeCompare(b.order.due_at ?? '￿') || (a.order.placed_at ?? '').localeCompare(b.order.placed_at ?? '')

/**
 * The open orders as a pipeline, one column per stage. Moving an order uses exactly the same offline path as its own
 * screen (changeOrderStatus, then a sync request), and offers only the moves this person's role may make, so the board
 * can never do something the order screen would refuse. Cancelling stays on the order screen: it needs a reason.
 *
 * Tapping a move button is the way to move on every device and with a keyboard. Dragging a card onto a column is an
 * extra on mouse screens, and a column only accepts the drop when that move is allowed.
 */
export function OrderBoard({ rows, role }: { rows: BoardRow[]; role: RoleDefinition | undefined }) {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const [now] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [dragging, setDragging] = useState<OrderRow | null>(null)
  const [over, setOver] = useState<OrderStatus | null>(null)

  const movesFor = (order: OrderRow): OrderStatus[] =>
    role && isOrderStatus(order.status) ? allowedNextStatuses(role, order.status).filter((s) => s !== 'cancelled') : []

  async function move(order: OrderRow, to: OrderStatus) {
    setFailed(null)
    setBusy(order.id)
    try {
      await changeOrderStatus(order, to, { source: 'manual' })
    } catch {
      // The local write failed (storage full or blocked, or a transition refused): the transaction rolled back, so nothing changed.
      setFailed(order.id)
      return
    } finally {
      setBusy(null)
    }
    requestSync()                       // outside the try: the message above only ever describes the local move
  }

  const accepts = (status: OrderStatus) => dragging !== null && movesFor(dragging).includes(status)
  const onDragOver = (status: OrderStatus) => (e: DragEvent) => {
    if (!accepts(status)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (over !== status) setOver(status)
  }
  const onDrop = (status: OrderStatus) => (e: DragEvent) => {
    e.preventDefault()
    const order = dragging
    setDragging(null); setOver(null)
    if (order && movesFor(order).includes(status)) void move(order, status)
  }

  // "Pending" only ever holds new website orders, and no move leads into it, so while it is empty it is never a
  // drop target: it is left out rather than spending a whole phone screen on an empty column.
  const columns = ACTIVE_STATUSES.map((status) => ({ status, cards: rows.filter((r) => r.order.status === status).sort(byUrgency) }))
    .filter(({ status, cards }) => status !== 'pending' || cards.length > 0)

  return (
    <div className="board mt-4" role="list" aria-label={t('orders.viewBoard')}>
      {columns.map(({ status, cards }) => {
        const { tone, icon: Icon } = STATUS_STYLE[status]
        const titleId = `board-${status}`
        return (
          <section key={status} role="listitem" aria-labelledby={titleId}
            onDragOver={onDragOver(status)} onDragLeave={() => over === status && setOver(null)} onDrop={onDrop(status)}
            className={cn('panel flex max-h-[calc(100dvh-14rem)] min-h-40 flex-col p-2', over === status && 'drop-ok', dragging && !accepts(status) && dragging.status !== status && 'opacity-50')}>
            <h2 id={titleId} className="flex items-center gap-2 px-1 pb-2 text-sm font-bold">
              <span aria-hidden className={cn('status-dot', tone, cards.length > 0 && LIVE_STATUSES.includes(status) && 'live')} />
              <Icon aria-hidden className={cn('size-4 shrink-0', tone)} />
              <span className="min-w-0 flex-1 truncate">{ORDER_STATUS_LABELS[status][lang]}</span>
              <span className="num-col rounded-full border border-rule px-2 text-xs">{cards.length}</span>
            </h2>
            {cards.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted">{t('orders.boardEmpty')}</p>
            ) : (
              <ol className="flex flex-col gap-2 overflow-y-auto">
                {cards.map(({ order, customer }) => {
                  const moves = movesFor(order)
                  const late = isOverdue(order.due_at, now)
                  const label = order.order_number ? `#${order.order_number}` : order.public_code.slice(0, 6)
                  return (
                    <li key={order.id} draggable={moves.length > 0} aria-busy={busy === order.id}
                      onDragStart={(e) => { setDragging(order); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', order.id) }}
                      onDragEnd={() => { setDragging(null); setOver(null) }}
                      className={cn('card panel-lift flex flex-col gap-2 p-2.5', moves.length > 0 && 'cursor-grab active:cursor-grabbing', dragging?.id === order.id && 'opacity-40')}>
                      <Link to={`/orders/${order.id}`} className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block font-extrabold" dir="ltr">{label}</span>
                          <span className="block truncate text-sm font-semibold">{customer?.full_name}</span>
                        </span>
                        <span className="shrink-0 text-sm font-bold" dir="ltr">{money(order.total, order.currency)}</span>
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {order.due_at && (
                          <span className={cn('flex items-center gap-1 font-semibold', late ? 'text-magenta' : 'text-muted')}>
                            {late ? <TriangleAlert aria-hidden className="size-3.5" /> : <Clock aria-hidden className="size-3.5" />}
                            {late ? `${t('orders.overdue')} · ` : ''}{dateTime(order.due_at, lang)}
                          </span>
                        )}
                        {order.source === 'web' && <span className="flex items-center gap-1 text-muted"><Globe aria-hidden className="size-3.5" />{t('order.fromWebsite')}</span>}
                        {order._rejected ? <span className="font-semibold text-magenta">{t('orders.rejected')}</span>
                          : order._pending && <span className="flex items-center gap-1 font-semibold text-warn"><CloudOff aria-hidden className="size-3.5" />{t('orders.local')}</span>}
                        {order.proof_status === 'changes_requested' && <span className="font-bold text-magenta">{t('proofs.listChanges')}</span>}
                        {order.proof_status === 'approved' && order.status === 'awaiting_approval' && <span className="font-bold text-ok">{t('proofs.listApproved')}</span>}
                      </div>
                      {moves.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {moves.map((to) => (
                            <button key={to} type="button" disabled={busy === order.id} onClick={() => void move(order, to)}
                              aria-label={t('orders.moveTo', { order: label, status: ORDER_STATUS_LABELS[to][lang] })}
                              className="min-h-11 rounded-md border border-ink px-3 text-xs font-bold disabled:opacity-40">
                              <span className="arrow-go" aria-hidden="true">←</span> {ORDER_STATUS_LABELS[to][lang]}
                            </button>
                          ))}
                        </div>
                      )}
                      {failed === order.id && <p role="alert" className="text-xs font-semibold text-magenta">{t('orders.moveFailed')}</p>}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}
