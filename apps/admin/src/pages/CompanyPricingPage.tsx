import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useBranch, useCan } from '../auth'
import { addPriceOverride, DuplicatePriceError, editPriceOverride, InvalidMutationError, listPriceOverrides, listProducts, removePriceOverride } from '../offline/actions'
import { db, type CompanyPriceOverrideRow, type ProductRow } from '../offline/db'
import { cleanDecimal } from '../offline/order-draft'
import { requestSync } from '../offline/request-sync'
import { asLocale, money } from '../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../lib/ui'

/** A company's own agreed prices, one per product. Staff still see and can override this when actually building an
 *  order — this is a suggestion the shop keeps on file, not a lock. */
export function CompanyPricingPage() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const navigate = useNavigate()
  const can = useCan()
  const { id = '' } = useParams()
  const currency = useBranch()?.baseCurrency ?? 'USD'

  const customer = useLiveQuery(() => db.customers.get(id), [id])
  const overrides = useLiveQuery(() => listPriceOverrides(id), [id], [] as CompanyPriceOverrideRow[])
  const products = useLiveQuery(listProducts, [], [] as ProductRow[])
  const byId = new Map(products.map((p) => [p.id, p]))

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<ProductRow | null>(null)
  const [price, setPrice] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (customer === undefined) return <p role="status" className="p-4 text-muted">{t('login.loading')}</p>
  if (!customer) return <section className="p-4"><p>{t('customer.notFound')}</p></section>

  const alreadyPriced = new Set(overrides.map((o) => o.product_id))
  const matches = query.trim().length >= 2
    ? products.filter((p) => !alreadyPriced.has(p.id) && (p.name_ar.includes(query) || p.name_en.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()))).slice(0, 8)
    : []

  async function add() {
    if (!picked || !price.trim()) return
    setError(null)
    setBusy(true)
    try {
      await addPriceOverride(id, picked.id, price.trim())
      requestSync()
      setPicked(null); setQuery(''); setPrice('')
    } catch (err) {
      setError(err instanceof DuplicatePriceError ? t('company.pricing.alreadyPriced') : err instanceof InvalidMutationError ? t('company.pricing.invalid') : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(override: CompanyPriceOverrideRow) {
    if (!editPrice.trim()) return
    setBusy(true)
    try {
      await editPriceOverride(override, editPrice.trim())
      requestSync()
      setEditing(null)
    } catch {
      setError(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(override: CompanyPriceOverrideRow) {
    if (!window.confirm(t('company.pricing.confirmRemove'))) return
    await removePriceOverride(override)
    requestSync()
  }

  return (
    <section className="mx-auto max-w-xl p-4">
      <button type="button" className="text-sm text-muted underline" onClick={() => navigate(-1)}><span className="arrow-back" aria-hidden="true">←</span> {t('common.back')}</button>
      <h1 className="mt-2 text-2xl font-extrabold">{t('company.pricing.title')}</h1>
      <p className="text-muted">{customer.company_name || customer.full_name}</p>

      {can('customers:write') && (
        <div className={`mt-4 border border-rule p-3 ${picked ? '' : 'flex flex-col gap-2'}`}>
          {!picked ? (
            <>
              <label className={labelCls}>{t('company.pricing.findProduct')}
                <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('company.pricing.findProductPlaceholder')} />
              </label>
              {matches.length > 0 && (
                <ul className="divide-y divide-rule border border-rule">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-tint" onClick={() => setPicked(p)}>
                        <span>{lang === 'ar' ? p.name_ar : p.name_en}</span>
                        <span className="text-sm text-muted" dir="ltr">{money(p.base_price, currency)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="font-semibold">{lang === 'ar' ? picked.name_ar : picked.name_en}</p>
              <p className="text-xs text-muted">{t('company.pricing.catalogPrice', { amount: money(picked.base_price, currency) })}</p>
              <label className={labelCls}>{t('company.pricing.agreedPrice')}
                <input className={inputCls} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(cleanDecimal(e.target.value))} />
              </label>
              {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
              <div className="flex gap-2">
                <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void add()}>{t('company.pricing.add')}</button>
                <button type="button" className={ghostBtn} onClick={() => { setPicked(null); setError(null) }}>{t('common.cancel')}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {overrides.length === 0 ? (
        <p className="mt-6 text-muted">{t('company.pricing.empty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {overrides.map((o) => {
            const product = byId.get(o.product_id)
            return (
              <li key={o.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{product ? (lang === 'ar' ? product.name_ar : product.name_en) : o.product_id}</span>
                  {editing === o.id ? (
                    <div className="flex items-center gap-2">
                      <input className={`${inputCls} w-24 py-1.5`} dir="ltr" inputMode="decimal" value={editPrice} onChange={(e) => setEditPrice(cleanDecimal(e.target.value))} />
                      <button type="button" className="text-sm font-semibold underline" disabled={busy} onClick={() => void saveEdit(o)}>{t('common.save')}</button>
                    </div>
                  ) : (
                    <span className="font-semibold" dir="ltr">{money(o.unit_price, currency)}</span>
                  )}
                </div>
                {can('customers:write') && editing !== o.id && (
                  <div className="mt-1 flex gap-3 text-xs">
                    <button type="button" className="font-semibold underline" onClick={() => { setEditing(o.id); setEditPrice(o.unit_price) }}>{t('common.edit')}</button>
                    <button type="button" className="font-semibold text-magenta underline" onClick={() => void remove(o)}>{t('company.pricing.remove')}</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
