import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db, type ConflictItem } from '../offline/db'
import { actionsFor, dismissConflict, discardConflict, kindOf, retryConflict, unresolvedConflicts, type ReviewAction } from '../offline/review'
import { requestSync } from '../offline/request-sync'
import { asLocale, dateTime, money, reasonText } from '../lib/format'
import { ghostBtn, primaryBtn } from '../lib/ui'

/**
 * Everything the server refused, with a plain sentence for what was attempted and why it failed, and the few
 * things a human can actually do about it. An empty screen here means nothing was lost.
 */
export function ReviewPage() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const entries = useLiveQuery(unresolvedConflicts, [], [] as ConflictItem[])
  const [busy, setBusy] = useState<string | null>(null)

  async function run(entry: ConflictItem, action: ReviewAction) {
    if (action === 'discard' && !window.confirm(t('review.confirmDiscard'))) return
    setBusy(entry.id)
    try {
      if (action === 'retry') { await retryConflict(entry.id); requestSync() }
      else if (action === 'discard') await discardConflict(entry.id)
      else await dismissConflict(entry.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('review.title')}</h1>
      {entries.length === 0 ? (
        <p className="mt-8 text-muted">{t('review.empty')}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">{t('review.intro')}</p>
          <ul className="mt-4 flex flex-col gap-3">
            {entries.map((entry) => (
              <li key={entry.id} className="border border-ink p-3">
                <p className="font-bold">{t(`review.kind.${kindOf(entry)}`, { defaultValue: t('review.kind.unknown') })}</p>
                <p className="mt-1 text-sm">
                  <span className="font-semibold">{entry.result === 'conflict' ? t('review.conflict') : t('review.rejected')}:</span>{' '}
                  {reasonText(t, entry.error)}
                </p>
                <Summary entry={entry} />
                <p className="mt-1 text-xs text-muted">{dateTime(entry.createdAt, lang)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {actionsFor(entry).map((action) => (
                    <button key={action} type="button" disabled={busy === entry.id}
                      className={`${action === 'retry' ? primaryBtn : ghostBtn} px-3 py-2 text-sm ${action === 'discard' ? 'text-magenta' : ''}`}
                      onClick={() => void run(entry, action)}>
                      {t(`review.action.${action}`)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** A short line naming what the entry is about, so the person is not reading raw identifiers. */
function Summary({ entry }: { entry: ConflictItem }) {
  const { t } = useTranslation()
  const { entity, entityId, payload } = entry.mutation
  const order = useLiveQuery(async () => {
    const id = entity === 'orders' ? entityId : typeof payload.order_id === 'string' ? payload.order_id : null
    return id ? await db.orders.get(id) : undefined
  }, [entity, entityId])

  const amount = typeof payload.amount === 'string' ? payload.amount : null
  if (!order && !amount) return null
  return (
    <p className="mt-1 text-sm text-muted">
      {order && <span dir="ltr">{order.order_number ? `#${order.order_number}` : order.public_code.slice(0, 6)}</span>}
      {order && amount ? ' · ' : ''}
      {amount && <span dir="ltr">{money(amount, order?.currency ?? 'USD')}</span>}
      {order?._rejected ? ` · ${t('review.orderNotCreated')}` : ''}
    </p>
  )
}
