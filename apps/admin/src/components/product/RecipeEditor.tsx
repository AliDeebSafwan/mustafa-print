import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InvalidMutationError, addRecipeLine, listInventory, recipeFor, removeRecipeLine } from '../../offline/actions'
import type { InventoryRow, Row } from '../../offline/db'
import { cleanDecimal } from '../../offline/order-draft'
import { requestSync } from '../../offline/request-sync'
import { asLocale } from '../../lib/format'
import { ghostBtn, inputCls } from '../../lib/ui'

/**
 * What one unit of this product eats. Filling this in is what lets the shop deduct materials automatically when the
 * job starts printing, instead of someone remembering to.
 */
export function RecipeEditor({ productId }: { productId: string }) {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const lines = useLiveQuery(() => recipeFor(productId), [productId], [] as Row[])
  const items = useLiveQuery(listInventory, [], [] as InventoryRow[])
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [waste, setWaste] = useState('')
  const [error, setError] = useState<string | null>(null)
  const byId = new Map(items.map((i) => [i.id, i]))
  const nameOf = (item: InventoryRow | undefined) => (item ? (lang === 'ar' ? item.name_ar : item.name_en) : '—')

  async function add() {
    setError(null)
    if (!itemId || !quantity.trim()) return setError(t('recipe.needBoth'))
    try {
      await addRecipeLine({ productId, itemId, quantityPerUnit: quantity, wastePct: waste })
      requestSync()
      setItemId('')
      setQuantity('')
      setWaste('')
    } catch (err) {
      setError(err instanceof InvalidMutationError ? t('recipe.invalid') : t('common.error'))
    }
  }

  async function remove(lineId: string) {
    await removeRecipeLine(lineId)
    requestSync()
  }

  return (
    <div className="border border-rule p-3">
      <p className="font-semibold">{t('recipe.title')}</p>
      <p className="mb-2 text-xs text-muted">{t('recipe.help')}</p>

      {lines.length > 0 && (
        <ul className="mb-3 divide-y divide-rule border-y border-rule text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-semibold">{nameOf(byId.get(String(line.item_id)))}</p>
                <p className="text-xs text-muted" dir="ltr">
                  {Number(line.quantity_per_unit)} {t(`inventory.unit.${byId.get(String(line.item_id))?.unit ?? 'piece'}`, { defaultValue: '' })}
                  {Number(line.waste_pct ?? 0) > 0 ? ` +${Number(line.waste_pct)}%` : ''}
                </p>
              </div>
              <button type="button" className="border border-rule px-3 py-1.5 text-muted" aria-label={t('recipe.remove')} onClick={() => void remove(line.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('recipe.noItems')}</p>
      ) : (
        <>
          <select className={inputCls} aria-label={t('recipe.material')} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">{t('recipe.material')}</option>
            {items.map((item) => <option key={item.id} value={item.id}>{nameOf(item)}</option>)}
          </select>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold">{t('recipe.perUnit')}
              <input className={inputCls} dir="ltr" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(cleanDecimal(e.target.value))} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">{t('recipe.waste')}
              <input className={inputCls} dir="ltr" inputMode="decimal" value={waste} onChange={(e) => setWaste(cleanDecimal(e.target.value))} />
            </label>
          </div>
          {error && <p role="alert" className="mt-2 text-sm font-semibold text-magenta">{error}</p>}
          <button type="button" className={`${ghostBtn} mt-2 w-full`} onClick={() => void add()}>{t('recipe.add')}</button>
        </>
      )}
    </div>
  )
}
