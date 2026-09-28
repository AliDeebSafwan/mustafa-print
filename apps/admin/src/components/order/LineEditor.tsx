import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { priceFor } from '../../offline/actions'
import { db, type ProductRow } from '../../offline/db'
import { asLocale, money } from '../../lib/format'
import { ghostBtn, inputCls } from '../../lib/ui'
import { cleanDecimal, newLine, type DraftLine } from '../../offline/order-draft'

interface Props {
  lines: DraftLine[]
  /** Computed line totals for the filled lines, in order (undefined while the amounts are not valid). */
  lineTotals: string[] | undefined
  currency: string
  onChange: (lines: DraftLine[]) => void
  /** When set, a company's own agreed price (if it has one for a product) is suggested instead of the catalogue's. */
  customerId?: string | null
}

const isFilled = (line: DraftLine) => Boolean(line.name.trim() || line.unitPrice.trim() || line.discount.trim())

export function LineEditor({ lines, lineTotals, currency, onChange, customerId }: Props) {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const products = useLiveQuery(async () => (await db.products.toArray()).filter((p) => p.is_active !== false && !p.deleted_at), [], [] as ProductRow[])

  const agreed = useLiveQuery(async () => {
    if (!customerId) return new Map<string, string>()
    const rows = await db.company_price_overrides.where('customer_id').equals(customerId).filter((r) => !r.deleted_at).toArray()
    return new Map(rows.map((r) => [r.product_id, r.unit_price]))
  }, [customerId], new Map<string, string>())
  /** The company's agreed price wins over the catalogue's (quantity tiers included): that is what was negotiated. */
  const suggested = (p: ProductRow, quantity: string) => agreed.get(p.id) ?? priceFor(p, quantity)

  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  /**
   * Quantity prices follow the catalogue as the cashier types the quantity ("1000 copies" drops the unit price),
   * but a price someone typed over by hand is never overwritten.
   */
  const changeQuantity = (line: DraftLine, quantity: string) => {
    const product = line.productId ? products.find((p) => p.id === line.productId) : undefined
    const untouched = product && line.unitPrice === suggested(product, line.quantity)
    update(line.key, { quantity, ...(untouched ? { unitPrice: suggested(product, quantity) } : {}) })
  }
  const remove = (key: string) => { const rest = lines.filter((l) => l.key !== key); onChange(rest.length ? rest : [newLine()]) }
  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id)
    if (!p) return
    const filled = lines.filter((l) => l.name.trim() || l.unitPrice.trim())          // a still-blank row is replaced, not kept
    const quantity = String(Number(p.min_quantity ?? 1))
    onChange([...filled, newLine({ name: lang === 'ar' ? p.name_ar : p.name_en, unitPrice: suggested(p, quantity), productId: p.id, quantity })])
  }

  // Totals arrive for the filled lines only, in order; pair each with its line by key.
  const totalByKey = new Map<string, string>()
  lines.filter(isFilled).forEach((line, n) => { const total = lineTotals?.[n]; if (total !== undefined) totalByKey.set(line.key, total) })

  return (
    <div className="flex flex-col gap-3">
      {products.length > 0 && (
        <select className={inputCls} value="" onChange={(e) => addProduct(e.target.value)} aria-label={t('newOrder.addFromCatalog')}>
          <option value="">{t('newOrder.addFromCatalog')}</option>
          {products.map((p) => <option key={p.id} value={p.id}>{lang === 'ar' ? p.name_ar : p.name_en} ({money(p.base_price, '')})</option>)}
        </select>
      )}
      {lines.map((line, i) => {
        const total = totalByKey.get(line.key)
        return (
          <div key={line.key} className="border border-rule p-3">
            <div className="flex items-start gap-2">
              <input className={inputCls} value={line.name} onChange={(e) => update(line.key, { name: e.target.value })} placeholder={t('newOrder.itemName')} aria-label={`${t('newOrder.itemName')} ${i + 1}`} />
              <button type="button" className="shrink-0 border border-rule px-3 py-2.5 text-muted" aria-label={t('newOrder.remove')} onClick={() => remove(line.key)}>✕</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold">{t('newOrder.qty')}
                <input className={inputCls} dir="ltr" inputMode="decimal" value={line.quantity} onChange={(e) => changeQuantity(line, cleanDecimal(e.target.value))} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold">{t('newOrder.price')}
                <input className={inputCls} dir="ltr" inputMode="decimal" value={line.unitPrice} onChange={(e) => update(line.key, { unitPrice: cleanDecimal(e.target.value) })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold">{t('newOrder.discount')}
                <input className={inputCls} dir="ltr" inputMode="decimal" value={line.discount} onChange={(e) => update(line.key, { discount: cleanDecimal(e.target.value) })} />
              </label>
            </div>
            {total !== undefined && <p className="mt-2 text-end text-sm font-bold" dir="ltr">{money(total, currency)}</p>}
          </div>
        )
      })}
      <button type="button" className={ghostBtn} onClick={() => onChange([...lines, newLine()])}>{t('newOrder.addCustom')}</button>
    </div>
  )
}
