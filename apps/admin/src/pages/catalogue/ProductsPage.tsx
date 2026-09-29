import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { PriceTier } from '@mpe/shared'
import { useBranch, useCan } from '../../auth'
import { RecipeEditor } from '../../components/product/RecipeEditor'
import { WebsiteSection } from '../../components/product/WebsiteSection'
import { InvalidMutationError, createProduct, editProduct, listProducts, setProductActive } from '../../offline/actions'
import type { ProductRow } from '../../offline/db'
import { cleanDecimal } from '../../offline/order-draft'
import { requestSync } from '../../offline/request-sync'
import { asLocale, money } from '../../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

const UNITS = ['piece', 'sheet', 'sqm', 'meter', 'set', 'hour'] as const
const MODELS = ['fixed', 'per_unit', 'tiered'] as const

type PricingModel = (typeof MODELS)[number]
type Draft = {
  sku: string; name_ar: string; name_en: string; category: string; unit: string; pricing_model: PricingModel; base_price: string; min_quantity: string; price_rules: PriceTier[]
  is_public: boolean; description_ar: string; description_en: string; cover_media_id: string | null; service_id: string | null
}
const emptyDraft = (): Draft => ({
  sku: '', name_ar: '', name_en: '', category: 'general', unit: 'piece', pricing_model: 'per_unit', base_price: '', min_quantity: '1', price_rules: [],
  is_public: false, description_ar: '', description_en: '', cover_media_id: null, service_id: null,
})
const draftFrom = (p: ProductRow): Draft => ({
  sku: p.sku, name_ar: p.name_ar, name_en: p.name_en, category: String(p.category ?? 'general'), unit: p.unit,
  pricing_model: (MODELS as readonly string[]).includes(String(p.pricing_model)) ? (p.pricing_model as PricingModel) : 'per_unit',
  base_price: String(p.base_price ?? ''), min_quantity: String(p.min_quantity ?? '1'),
  price_rules: (p.price_rules as PriceTier[] | undefined) ?? [],
  is_public: Boolean(p.is_public), description_ar: p.description_ar ?? '', description_en: p.description_en ?? '', cover_media_id: p.cover_media_id ?? null,
  service_id: p.service_id ?? null,
})

/** The shop's catalogue: what it sells, what it costs, and what is still on offer. */
export function ProductsPage() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const currency = useBranch()?.baseCurrency ?? 'USD'
  const products = useLiveQuery(listProducts, [], [] as ProductRow[])
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null)

  if (editing) {
    return <ProductForm product={editing === 'new' ? null : editing} currency={currency} onDone={() => setEditing(null)} />
  }

  return (
    <section className="mx-auto max-w-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('products.title')}</h1>
        <button className={`${primaryBtn} py-2.5`} onClick={() => setEditing('new')}>{t('products.new')}</button>
      </div>
      <Link to="/products/import" className="mt-2 inline-block text-sm font-semibold underline underline-offset-4">{t('import.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      {products.length === 0 ? (
        <p className="mt-8 text-muted">{t('products.empty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {products.map((p) => (
            <li key={p.id} className={`flex items-center justify-between gap-3 py-3 ${p.is_active === false ? 'opacity-60' : ''}`}>
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setEditing(p)}>
                <p className="font-bold">{lang === 'ar' ? p.name_ar : p.name_en}</p>
                <p className="text-sm text-muted"><span dir="ltr">{p.sku}</span> · {t(`products.unit.${p.unit}`, { defaultValue: p.unit })}
                  {p.is_active === false ? ` · ${t('products.retired')}` : ''}{p._pending ? ` · ${t('orders.local')}` : ''}</p>
              </button>
              <p className="shrink-0 font-semibold" dir="ltr">{money(p.base_price, currency)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ProductForm({ product, currency, onDone }: { product: ProductRow | null; currency: string; onDone: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const can = useCan()
  const [draft, setDraft] = useState<Draft>(product ? draftFrom(product) : emptyDraft())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((d) => ({ ...d, [field]: value }))
  const tiered = draft.pricing_model === 'tiered'

  const setTier = (index: number, patch: Partial<PriceTier>) =>
    set('price_rules', draft.price_rules.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)))

  async function save() {
    setError(null)
    if (!draft.sku.trim() || !draft.name_ar.trim() || !draft.name_en.trim()) return setError(t('products.needNames'))
    // No silent zero: a product that should cost nothing says so explicitly.
    if (!draft.base_price.trim()) return setError(t('products.needPrice'))
    setBusy(true)
    try {
      const values = { ...draft, price_rules: tiered ? draft.price_rules.filter((tier) => String(tier.min_quantity).trim() && String(tier.unit_price).trim()) : [] }
      if (product) await editProduct(product, values)
      else await createProduct(values)
      requestSync()
      onDone()
    } catch (err) {
      setError(err instanceof InvalidMutationError ? t('products.invalid') : t('common.error'))
      setBusy(false)
    }
  }

  async function retire(isActive: boolean) {
    if (!product) return
    await setProductActive(product, isActive)
    requestSync()
    onDone()
  }

  return (
    <section className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-extrabold">{product ? t('products.edit') : t('products.new')}</h1>
      <div className="mt-4 flex flex-col gap-3">
        <label className={labelCls}>{t('products.sku')}
          <input className={inputCls} dir="ltr" value={draft.sku} disabled={Boolean(product)} onChange={(e) => set('sku', e.target.value)} />
          {product && <span className="text-xs font-normal text-muted">{t('products.skuFixed')}</span>}
        </label>
        <label className={labelCls}>{t('products.nameAr')}<input className={inputCls} value={draft.name_ar} onChange={(e) => set('name_ar', e.target.value)} /></label>
        <label className={labelCls}>{t('products.nameEn')}<input className={inputCls} dir="ltr" value={draft.name_en} onChange={(e) => set('name_en', e.target.value)} /></label>
        <label className={labelCls}>{t('products.category')}<input className={inputCls} value={draft.category} onChange={(e) => set('category', e.target.value)} /></label>
        <label className={labelCls}>{t('products.unitLabel')}
          <select className={inputCls} value={draft.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{t(`products.unit.${u}`)}</option>)}
          </select>
        </label>
        <label className={labelCls}>{t('products.pricing')}
          <select className={inputCls} value={draft.pricing_model} onChange={(e) => set('pricing_model', e.target.value as PricingModel)}>
            {MODELS.map((m) => <option key={m} value={m}>{t(`products.model.${m}`)}</option>)}
          </select>
        </label>
        <label className={labelCls}>{t('products.price')} ({currency})
          <input className={inputCls} dir="ltr" inputMode="decimal" value={draft.base_price} onChange={(e) => set('base_price', cleanDecimal(e.target.value))} />
        </label>
        <label className={labelCls}>{t('products.minQty')}
          <input className={inputCls} dir="ltr" inputMode="decimal" value={draft.min_quantity} onChange={(e) => set('min_quantity', cleanDecimal(e.target.value))} />
        </label>

        {tiered && (
          <div className="border border-rule p-3">
            <p className="font-semibold">{t('products.tiers')}</p>
            <p className="mb-2 text-xs text-muted">{t('products.tiersHelp')}</p>
            {draft.price_rules.map((tier, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-semibold">{t('products.fromQty')}
                  <input className={inputCls} dir="ltr" inputMode="decimal" value={String(tier.min_quantity)} onChange={(e) => setTier(i, { min_quantity: cleanDecimal(e.target.value) })} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">{t('products.tierPrice')}
                  <input className={inputCls} dir="ltr" inputMode="decimal" value={String(tier.unit_price)} onChange={(e) => setTier(i, { unit_price: cleanDecimal(e.target.value) })} />
                </label>
                <button type="button" className="border border-rule px-3 py-2.5 text-muted" aria-label={t('newOrder.remove')}
                  onClick={() => set('price_rules', draft.price_rules.filter((_, x) => x !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className={ghostBtn} onClick={() => set('price_rules', [...draft.price_rules, { min_quantity: '', unit_price: '' }])}>{t('products.addTier')}</button>
          </div>
        )}

        {can('content:manage') && (
          <WebsiteSection
            value={{ is_public: draft.is_public, description_ar: draft.description_ar, description_en: draft.description_en, cover_media_id: draft.cover_media_id, service_id: draft.service_id }}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            lang={lang}
          />
        )}

        {product && can('inventory:manage') && <RecipeEditor productId={product.id} />}

        {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
          <button type="button" className={ghostBtn} onClick={onDone}>{t('common.cancel')}</button>
        </div>
        {product && (
          <button type="button" className={`${ghostBtn} ${product.is_active === false ? '' : 'text-magenta'}`} onClick={() => void retire(product.is_active === false)}>
            {product.is_active === false ? t('products.restore') : t('products.retire')}
          </button>
        )}
        {product && <p className="text-xs text-muted">{t('products.retireHelp')}</p>}
      </div>
    </section>
  )
}
