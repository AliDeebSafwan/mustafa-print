import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentError, ordersApi } from '../../content'
import { cleanDecimal } from '../../offline/order-draft'
import { money } from '../../lib/format'
import { inputCls, primaryBtn } from '../../lib/ui'

/**
 * Delivery covers all of Lebanon, priced per order by the owner. Needs a connection: it writes straight to the
 * server, because a delivery order cannot move to "confirmed" until the fee is set (the server enforces this).
 */
export function DeliveryFeeForm({ orderId, currency, subtotalBeforeFee, onSet }: { orderId: string; currency: string; subtotalBeforeFee: string; onSet: () => void }) {
  const { t } = useTranslation()
  const [fee, setFee] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!fee.trim() || Number(fee) <= 0) return setError(t('order.deliveryFee.invalid'))
    setBusy(true)
    try {
      await ordersApi.setDeliveryFee(orderId, fee)
      onSet()
    } catch (err) {
      setError(err instanceof ContentError && err.code === 'offline' ? t('site.error.offline') : t('common.error'))
      setBusy(false)
    }
  }

  return (
    <div className="border border-magenta p-3">
      <p className="font-bold text-magenta">{t('order.deliveryFee.title')}</p>
      <p className="mt-1 text-sm text-muted">{t('order.deliveryFee.help')}</p>
      <label className="mt-3 flex flex-col gap-1.5 text-sm font-semibold">{t('order.deliveryFee.amount')} ({currency})
        <input className={`${inputCls} text-lg font-bold`} dir="ltr" inputMode="decimal" value={fee} onChange={(e) => setFee(cleanDecimal(e.target.value))} />
      </label>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-magenta">{error}</p>}
      <button type="button" className={`${primaryBtn} mt-3 w-full`} disabled={busy} onClick={() => void submit()}>{t('order.deliveryFee.set')}</button>
      <p className="mt-1 text-xs text-muted">
        {fee.trim() && !Number.isNaN(Number(fee)) ? t('order.deliveryFee.newTotal', { amount: money((Number(subtotalBeforeFee) + Number(fee)).toFixed(2), currency) }) : ''}
      </p>
    </div>
  )
}
