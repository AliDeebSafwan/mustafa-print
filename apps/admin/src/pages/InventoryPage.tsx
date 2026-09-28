import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useBranch, useCan } from '../auth'
import {
  InvalidMovementError, InvalidMutationError, createInventoryItem, editInventoryItem, isLowStock, listInventory,
  MOVEMENT_TYPES, movementsFor, recordMovement, stockValue, type MovementType,
} from '../offline/actions'
import type { InventoryRow, Row } from '../offline/db'
import { cleanDecimal } from '../offline/order-draft'
import { requestSync } from '../offline/request-sync'
import { asLocale, dateTime, money } from '../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../lib/ui'

const CATEGORIES = ['paper', 'ink', 'plate', 'film', 'packaging', 'chemical', 'spare_part', 'other'] as const
const UNITS = ['sheet', 'ream', 'ml', 'liter', 'g', 'kg', 'piece', 'meter', 'roll', 'box'] as const

/** The store: what is left, what is running out, and what moved. */
export function InventoryPage() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const can = useCan()
  const currency = useBranch()?.baseCurrency ?? 'USD'
  const items = useLiveQuery(listInventory, [], [] as InventoryRow[])
  const [view, setView] = useState<{ mode: 'item'; item: InventoryRow } | { mode: 'new' } | null>(null)

  if (view?.mode === 'new') return <ItemForm item={null} onDone={() => setView(null)} />
  if (view?.mode === 'item') return <ItemDetail item={view.item} currency={currency} onDone={() => setView(null)} />

  const low = items.filter(isLowStock)
  return (
    <section className="mx-auto max-w-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('inventory.title')}</h1>
        {can('inventory:manage') && <button className={`${primaryBtn} py-2.5`} onClick={() => setView({ mode: 'new' })}>{t('inventory.new')}</button>}
      </div>
      <Link to="/inventory/import" className="mt-2 inline-block text-sm font-semibold underline underline-offset-4">{t('importInv.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>

      {low.length > 0 && (
        <p role="status" className="mt-4 border-s-4 border-magenta bg-tint p-3 text-sm font-semibold">{t('inventory.lowCount', { count: low.length })}</p>
      )}

      {items.length === 0 ? (
        <p className="mt-8 text-muted">{t('inventory.empty')}</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className={`flex w-full items-center justify-between gap-3 py-3 text-start ${item.is_active === false ? 'opacity-60' : ''}`} onClick={() => setView({ mode: 'item', item })}>
                  <div className="min-w-0">
                    <p className="font-bold">{lang === 'ar' ? item.name_ar : item.name_en}</p>
                    <p className="text-sm text-muted"><span dir="ltr">{item.sku}</span> · {t(`inventory.category.${item.category}`, { defaultValue: String(item.category) })}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="font-semibold" dir="ltr">{Number(item.quantity_on_hand)} {t(`inventory.unit.${item.unit}`, { defaultValue: item.unit })}</p>
                    {isLowStock(item) && <span className="text-xs font-bold text-magenta">{t('inventory.low')}</span>}
                    {Number(item.quantity_on_hand) < 0 && <span className="block text-xs font-bold text-magenta">{t('inventory.negative')}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {can('inventory:manage') && <p className="mt-3 text-sm text-muted">{t('inventory.value', { amount: money(stockValue(items), currency) })}</p>}
        </>
      )}
    </section>
  )
}

/** One item: its balance, a way to move stock, and what it has done lately. */
function ItemDetail({ item: initial, currency, onDone }: { item: InventoryRow; currency: string; onDone: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const can = useCan()
  const item = useLiveQuery(async () => (await import('../offline/db')).db.inventory_items.get(initial.id), [initial.id]) ?? initial
  const movements = useLiveQuery(() => movementsFor(item.id), [item.id], [] as Row[])
  const [editing, setEditing] = useState(false)

  if (editing) return <ItemForm item={item} onDone={() => setEditing(false)} />

  return (
    <section className="mx-auto max-w-xl p-4">
      <button type="button" className="text-sm text-muted underline" onClick={onDone}><span className="arrow-back" aria-hidden="true">←</span> {t('inventory.title')}</button>
      <h1 className="mt-2 text-2xl font-extrabold">{lang === 'ar' ? item.name_ar : item.name_en}</h1>
      <p className="text-sm text-muted" dir="ltr">{item.sku}</p>

      <p className="mt-4 text-3xl font-extrabold" dir="ltr">{Number(item.quantity_on_hand)} {t(`inventory.unit.${item.unit}`, { defaultValue: item.unit })}</p>
      <p className="text-sm text-muted">{t('inventory.reorderAt', { level: Number(item.reorder_level) })}{item.supplier_name ? ` · ${item.supplier_name}` : ''}</p>
      {Number(item.quantity_on_hand) < 0 && <p role="alert" className="mt-2 border-s-4 border-magenta bg-tint p-2 text-sm font-semibold">{t('inventory.negativeHelp')}</p>}

      {can('inventory:receive') || can('inventory:consume') || can('inventory:adjust') ? <MovementForm item={item} currency={currency} /> : null}

      {can('inventory:manage') && <button type="button" className={`${ghostBtn} mt-4 w-full`} onClick={() => setEditing(true)}>{t('inventory.edit')}</button>}

      <h2 className="mt-6 font-bold">{t('inventory.history')}</h2>
      {movements.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('inventory.noMovements')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-rule border-y border-rule text-sm">
          {movements.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-semibold">{t(`inventory.movement.${m.movement_type}`, { defaultValue: String(m.movement_type) })}</p>
                <p className="text-xs text-muted">{dateTime(String(m.occurred_at ?? ''), lang)}{m.reason === 'auto:bom' ? ` · ${t('inventory.autoFromJob')}` : ''}</p>
              </div>
              <p className={`font-bold ${Number(m.quantity_delta) < 0 ? 'text-magenta' : ''}`} dir="ltr">{Number(m.quantity_delta) > 0 ? '+' : ''}{Number(m.quantity_delta)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MovementForm({ item, currency }: { item: InventoryRow; currency: string }) {
  const { t } = useTranslation()
  const can = useCan()
  const allowed = MOVEMENT_TYPES.filter((type) =>
    type === 'receipt' || type === 'return' ? can('inventory:receive')
    : type === 'consumption' || type === 'waste' ? can('inventory:consume')
    : can('inventory:adjust'))
  const [type, setType] = useState<MovementType>(allowed[0] ?? 'adjustment')
  const [amount, setAmount] = useState('')
  const [cost, setCost] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  if (allowed.length === 0) return null

  async function submit() {
    setMessage(null)
    setBusy(true)
    try {
      await recordMovement({ itemId: item.id, type, amount, unitCost: type === 'receipt' && cost ? cost : null, reason })
      requestSync()
      setAmount('')
      setReason('')
      setMessage({ kind: 'ok', text: t('inventory.recorded') })
    } catch (err) {
      const reasonCode = err instanceof InvalidMovementError ? err.reason : err instanceof InvalidMutationError ? 'invalid_amount' : 'error'
      setMessage({ kind: 'error', text: t(`inventory.err.${reasonCode}`, { defaultValue: t('common.error') }) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border border-ink p-3">
      <label className={labelCls}>{t('inventory.movementType')}
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as MovementType)}>
          {allowed.map((m) => <option key={m} value={m}>{t(`inventory.movement.${m}`)}</option>)}
        </select>
      </label>
      <label className={`${labelCls} mt-3`}>{t('inventory.amount')} ({t(`inventory.unit.${item.unit}`, { defaultValue: item.unit })})
        <input className={`${inputCls} text-xl font-bold`} dir="ltr" inputMode="decimal" value={amount}
          onChange={(e) => setAmount(type === 'adjustment' ? e.target.value.replace(/[^\d.-]/g, '') : cleanDecimal(e.target.value))} />
        {type === 'adjustment' && <span className="text-xs font-normal text-muted">{t('inventory.adjustHelp')}</span>}
      </label>
      {type === 'receipt' && (
        <label className={`${labelCls} mt-3`}>{t('inventory.unitCost')} ({currency})
          <input className={inputCls} dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(cleanDecimal(e.target.value))} />
        </label>
      )}
      <label className={`${labelCls} mt-3`}>{t('inventory.reason')}
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm font-semibold ${message.kind === 'error' ? 'text-magenta' : 'text-ok'}`}>{message.text}</p>}
      <button type="button" className={`${primaryBtn} mt-3 w-full`} disabled={busy} onClick={() => void submit()}>{t('inventory.record')}</button>
    </div>
  )
}

function ItemForm({ item, onDone }: { item: InventoryRow | null; onDone: () => void }) {
  const { t } = useTranslation()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const form: Record<string, string> = {
    sku: item?.sku ?? '', name_ar: item?.name_ar ?? '', name_en: item?.name_en ?? '', category: String(item?.category ?? 'paper'),
    unit: item?.unit ?? 'sheet', reorder_level: String(item?.reorder_level ?? '0'), reorder_quantity: String(item?.reorder_quantity ?? ''),
    cost_per_unit: String(item?.cost_per_unit ?? ''), supplier_name: String(item?.supplier_name ?? ''), ...edits,
  }
  const set = (field: string, value: string) => setEdits((e) => ({ ...e, [field]: value }))

  async function save() {
    setError(null)
    if (!form.sku.trim() || !form.name_ar.trim() || !form.name_en.trim()) return setError(t('inventory.needNames'))
    setBusy(true)
    try {
      if (item) await editInventoryItem(item, form)
      else await createInventoryItem({ sku: form.sku, name_ar: form.name_ar, name_en: form.name_en, category: form.category, unit: form.unit,
        reorder_level: form.reorder_level || '0', reorder_quantity: form.reorder_quantity || null, cost_per_unit: form.cost_per_unit || null, supplier_name: form.supplier_name || null })
      requestSync()
      onDone()
    } catch (err) {
      setError(err instanceof InvalidMutationError ? t('inventory.invalid') : t('common.error'))
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-extrabold">{item ? t('inventory.edit') : t('inventory.new')}</h1>
      <div className="mt-4 flex flex-col gap-3">
        <label className={labelCls}>{t('inventory.sku')}
          <input className={inputCls} dir="ltr" value={form.sku} disabled={Boolean(item)} onChange={(e) => set('sku', e.target.value)} />
        </label>
        <label className={labelCls}>{t('products.nameAr')}<input className={inputCls} value={form.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></label>
        <label className={labelCls}>{t('products.nameEn')}<input className={inputCls} dir="ltr" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} /></label>
        <label className={labelCls}>{t('inventory.categoryLabel')}
          <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`inventory.category.${c}`)}</option>)}
          </select>
        </label>
        <label className={labelCls}>{t('inventory.unitLabel')}
          <select className={inputCls} value={form.unit} disabled={Boolean(item)} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{t(`inventory.unit.${u}`)}</option>)}
          </select>
          {item && <span className="text-xs font-normal text-muted">{t('inventory.unitFixed')}</span>}
        </label>
        <label className={labelCls}>{t('inventory.reorderLevel')}<input className={inputCls} dir="ltr" inputMode="decimal" value={form.reorder_level} onChange={(e) => set('reorder_level', cleanDecimal(e.target.value))} /></label>
        <label className={labelCls}>{t('inventory.unitCostLabel')}<input className={inputCls} dir="ltr" inputMode="decimal" value={form.cost_per_unit} onChange={(e) => set('cost_per_unit', cleanDecimal(e.target.value))} /></label>
        <label className={labelCls}>{t('inventory.supplier')}<input className={inputCls} value={form.supplier_name} onChange={(e) => set('supplier_name', e.target.value)} /></label>
        {item && <p className="text-xs text-muted">{t('inventory.balanceHelp')}</p>}
        {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
          <button type="button" className={ghostBtn} onClick={onDone}>{t('common.cancel')}</button>
        </div>
      </div>
    </section>
  )
}
