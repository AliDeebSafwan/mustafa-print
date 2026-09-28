import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCents, toCents } from '@mpe/shared'
import { PaymentError, recordPaymentLocally } from '../../offline/actions'
import type { OrderRow } from '../../offline/db'
import { cleanDecimal } from '../../offline/order-draft'
import { requestSync } from '../../offline/request-sync'
import { money } from '../../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

interface Props { order: OrderRow; canRefund: boolean }

/** Cash at the counter, cash collected on delivery, or a refund. The amount defaults to what is still owed. */
export function PaymentForm({ order, canRefund }: Props) {
  const { t } = useTranslation()
  const paidCents = toCents(order.paid_total ?? '0') ?? 0
  const remainingCents = Math.max(0, (toCents(order.total) ?? 0) - paidCents)
  const [type, setType] = useState<'payment' | 'refund'>('payment')
  const [method, setMethod] = useState<'cash' | 'cod'>(order.payment_method === 'cash' ? 'cash' : 'cod')
  const [amount, setAmount] = useState(remainingCents > 0 ? formatCents(remainingCents) : '')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const refunding = type === 'refund'
  const limitCents = refunding ? paidCents : remainingCents
  const cents = toCents(amount)
  // Paying more than is owed is almost always a typo. (The server still accepts it: money that really changed hands must be recorded.)
  const tooMuch = cents !== null && cents > limitCents

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    if (cents === null || cents <= 0) return setMessage({ kind: 'error', text: t('pay.invalid') })
    if (tooMuch) return setMessage({ kind: 'error', text: refunding ? t('pay.refundExceeds', { paid: money(formatCents(paidCents), order.currency) }) : t('pay.exceeds', { remaining: money(formatCents(remainingCents), order.currency) }) })
    setBusy(true)
    try {
      await recordPaymentLocally({ orderId: order.id, type, method, amount: formatCents(cents), note })
      requestSync()
      setNote('')
      setAmount('')
      setMessage({ kind: 'ok', text: t('pay.saved') })
    } catch (err) {
      const code = err instanceof PaymentError ? err.code : 'error'
      setMessage({ kind: 'error', text: t(`pay.err.${code}`, { defaultValue: t('common.error') }) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border border-ink p-3">
      {canRefund && paidCents > 0 && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {(['payment', 'refund'] as const).map((kind) => (
            <button key={kind} type="button" role="radio" aria-checked={type === kind}
              onClick={() => { setType(kind); setAmount(kind === 'refund' ? formatCents(paidCents) : remainingCents > 0 ? formatCents(remainingCents) : '') }}
              className={`border border-ink py-2.5 font-semibold ${type === kind ? 'bg-ink text-white' : ''}`}>{t(`pay.type.${kind}`)}</button>
          ))}
        </div>
      )}
      <label className={labelCls}>{t('pay.amount')} <span className="font-normal text-muted">({order.currency})</span>
        <input className={`${inputCls} text-xl font-bold`} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(cleanDecimal(e.target.value))} />
      </label>
      <label className={labelCls}>{t('pay.method')}
        <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'cod')}>
          <option value="cash">{t('method.cash')}</option>
          <option value="cod">{t('method.cod')}</option>
        </select>
      </label>
      <label className={labelCls}>{t('pay.note')}<input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {tooMuch && !message && <p className="text-sm font-semibold text-warn">{refunding ? t('pay.refundExceeds', { paid: money(formatCents(paidCents), order.currency) }) : t('pay.exceeds', { remaining: money(formatCents(remainingCents), order.currency) })}</p>}
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm font-semibold ${message.kind === 'error' ? 'text-magenta' : 'text-ok'}`}>{message.text}</p>}
      <button type="submit" className={refunding ? ghostBtn : primaryBtn} disabled={busy}>{refunding ? t('pay.submitRefund') : t('pay.submit')}</button>
    </form>
  )
}
