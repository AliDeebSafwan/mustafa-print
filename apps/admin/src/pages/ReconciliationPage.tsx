import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCents } from '@mpe/shared'
import { useCan } from '../auth'
import { settleCod, totalUnsettledCents, unsettledCod, type UnsettledCod } from '../offline/actions'
import { requestSync } from '../offline/request-sync'
import { dateTime, money } from '../lib/format'
import { primaryBtn } from '../lib/ui'

/** Every COD payment collected but not yet handed over to the shop, and a way to record it as settled. Works
 *  offline: the list comes straight from what has already synced to this device, and settling queues like anything
 *  else. Not grouped by who collected it — staff accounts are not tracked by identity for this. */
export function ReconciliationPage() {
  const { t, i18n } = useTranslation()
  const can = useCan()
  const rows = useLiveQuery(unsettledCod, [])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function settle(row: UnsettledCod) {
    setBusyId(row.transaction.id)
    setMessage(null)
    try {
      await settleCod([row.transaction])
      requestSync()
      setMessage(t('reconcile.settledOne'))
    } finally {
      setBusyId(null)
    }
  }

  async function settleAll() {
    if (!rows || rows.length === 0) return
    setBusyId('all')
    setMessage(null)
    try {
      const count = await settleCod(rows.map((r) => r.transaction))
      requestSync()
      setMessage(t('reconcile.settled', { count }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('reconcile.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('reconcile.help')}</p>
      {message && <p role="status" className="mt-3 text-sm font-semibold text-ok">{message}</p>}

      {rows && rows.length === 0 && <p className="mt-6 text-muted">{t('reconcile.empty')}</p>}

      {rows && rows.length > 0 && (
        <>
          <div className="mt-4 flex items-center justify-between gap-3 border border-ink p-3">
            <div>
              <p className="text-xs text-muted">{t('reconcile.collections', { count: rows.length })}</p>
              <p className="text-lg font-extrabold" dir="ltr">{money(formatCents(totalUnsettledCents(rows)), 'USD')}</p>
            </div>
            {can('transactions:settle') && (
              <button type="button" className={primaryBtn} disabled={busyId !== null} onClick={() => void settleAll()}>
                {busyId === 'all' ? t('reconcile.settling') : t('reconcile.settleAll')}
              </button>
            )}
          </div>

          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {rows.map((r) => (
              <li key={r.transaction.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="font-semibold">{r.order ? `#${r.order.order_number ?? r.order.public_code}` : t('reconcile.unknownOrder')}</p>
                  <p className="text-xs text-muted">{r.transaction.collected_at ? dateTime(r.transaction.collected_at, i18n.language) : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold" dir="ltr">{money(r.transaction.amount, 'USD')}</span>
                  {can('transactions:settle') && (
                    <button type="button" className="text-sm font-semibold underline" disabled={busyId !== null} onClick={() => void settle(r)}>
                      {busyId === r.transaction.id ? t('reconcile.settling') : t('reconcile.settle')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
