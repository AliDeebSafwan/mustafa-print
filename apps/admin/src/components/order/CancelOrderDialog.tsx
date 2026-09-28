import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cancelOrder } from '../../offline/actions'
import type { OrderRow } from '../../offline/db'
import { requestSync } from '../../offline/request-sync'
import { ghostBtn, inputCls, labelCls } from '../../lib/ui'

/**
 * Cancelling always asks why, in writing. The reason is stored on the order, and it is what the shop reads months
 * later when a customer asks what happened.
 */
export function CancelOrderDialog({ order }: { order: OrderRow }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (reason.trim().length < 3) return setError(t('order.cancelNeedsReason'))
    setBusy(true)
    try {
      await cancelOrder(order, reason)
      requestSync()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return <button type="button" className={`${ghostBtn} w-full text-magenta`} onClick={() => setOpen(true)}>{t('order.cancelOrder')}</button>

  return (
    <div className="border border-magenta p-3">
      <label className={labelCls}>{t('order.cancelReason')}
        <input className={inputCls} value={reason} onChange={(e) => { setReason(e.target.value); setError(null) }} autoFocus />
      </label>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-magenta">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className="flex-1 bg-magenta px-4 py-3 font-bold text-white disabled:opacity-40" disabled={busy} onClick={() => void confirm()}>{t('order.cancelConfirm')}</button>
        <button type="button" className={ghostBtn} onClick={() => setOpen(false)}>{t('order.cancelKeep')}</button>
      </div>
    </div>
  )
}
