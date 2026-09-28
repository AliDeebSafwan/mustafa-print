import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { TERMINAL_STATUSES } from '@mpe/shared'
import { InvalidMutationError, editOrder } from '../offline/actions'
import { db } from '../offline/db'
import { requestSync } from '../offline/request-sync'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../lib/ui'

/**
 * Corrects the details of an order that was already taken: notes, delivery, due date, how it will be paid.
 * Items and prices are not here — changing what is charged is a separate job the server must recompute.
 */
export function EditOrderPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const order = useLiveQuery(() => db.orders.get(id), [id])
  // Derived from the stored order plus what the person typed; see EditCustomerPage for why.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (order === undefined) return <p role="status" className="p-4 text-muted">{t('login.loading')}</p>
  if (!order) return <section className="p-4"><p>{t('order.notFound')}</p></section>
  const row = order                                      // narrowed once, so the save handler below has a certain type
  if ((TERMINAL_STATUSES as readonly string[]).includes(order.status)) {
    return <section className="p-4"><p role="alert">{t('order.closedCannotEdit')}</p></section>
  }

  const form: Record<string, string> = {
    fulfillment_type: String(row.fulfillment_type ?? 'pickup'), payment_method: String(row.payment_method ?? 'cod'),
    delivery_address: String(row.delivery_address ?? ''), delivery_city: String(row.delivery_city ?? ''), delivery_notes: String(row.delivery_notes ?? ''),
    due_at: row.due_at ? String(row.due_at).slice(0, 10) : '', customer_notes: String(row.customer_notes ?? ''), internal_notes: String(row.internal_notes ?? ''),
    ...edits,
  }
  const set = (field: string, value: string) => setEdits((e) => ({ ...e, [field]: value }))
  const delivery = form.fulfillment_type === 'delivery'

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (delivery && !form.delivery_address.trim()) return setError(t('issue.address'))
    setBusy(true)
    try {
      // The date box gives a day; the order is due by the end of it.
      const changed = await editOrder(row, { ...form, due_at: form.due_at ? new Date(`${form.due_at}T23:59:00`).toISOString() : null })
      if (changed) requestSync()
      navigate(-1)
    } catch (err) {
      setError(err instanceof InvalidMutationError ? t('issue.generic') : t('common.error'))
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-extrabold">{t('order.edit')}</h1>
      <form onSubmit={save} className="mt-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('newOrder.fulfillment')}>
          {(['pickup', 'delivery'] as const).map((kind) => (
            <button key={kind} type="button" role="radio" aria-checked={form.fulfillment_type === kind} onClick={() => set('fulfillment_type', kind)}
              className={`border border-ink py-3 font-semibold ${form.fulfillment_type === kind ? 'bg-ink text-white' : ''}`}>{t(`newOrder.${kind}`)}</button>
          ))}
        </div>
        {delivery && (
          <>
            <label className={labelCls}>{t('newOrder.address')}<input className={inputCls} value={form.delivery_address} onChange={(e) => set('delivery_address', e.target.value)} /></label>
            <label className={labelCls}>{t('newOrder.city')}<input className={inputCls} value={form.delivery_city} onChange={(e) => set('delivery_city', e.target.value)} /></label>
            <label className={labelCls}>{t('newOrder.deliveryNotes')}<input className={inputCls} value={form.delivery_notes} onChange={(e) => set('delivery_notes', e.target.value)} /></label>
          </>
        )}
        <label className={labelCls}>{t('newOrder.method')}
          <select className={inputCls} value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
            <option value="cod">{t('method.cod')}</option>
            <option value="cash">{t('method.cash')}</option>
            <option value="whish_money">{t('method.whish_money')}</option>
          </select>
        </label>
        <label className={labelCls}>{t('newOrder.dueDate')}<input className={inputCls} type="date" value={form.due_at} onChange={(e) => set('due_at', e.target.value)} /></label>
        <label className={labelCls}>{t('newOrder.customerNotes')}<textarea className={inputCls} rows={2} value={form.customer_notes} onChange={(e) => set('customer_notes', e.target.value)} /></label>
        <label className={labelCls}>{t('newOrder.internalNotes')}<textarea className={inputCls} rows={2} value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} /></label>
        <p className="text-xs text-muted">{t('order.itemsNotEditable')}</p>
        {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className={`${primaryBtn} flex-1`} disabled={busy}>{t('common.save')}</button>
          <button type="button" className={ghostBtn} onClick={() => navigate(-1)}>{t('common.cancel')}</button>
        </div>
      </form>
    </section>
  )
}
