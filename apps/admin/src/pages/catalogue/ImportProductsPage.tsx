import Papa from 'papaparse'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PRICING_MODELS, PRODUCT_UNITS, decimal } from '@mpe/shared'
import { useCan } from '../../auth'
import { createProduct, editProduct, listProducts, type ProductInput } from '../../offline/actions'
import type { ProductRow } from '../../offline/db'
import { requestSync } from '../../offline/request-sync'
import { ghostBtn, inputCls, primaryBtn } from '../../lib/ui'

const COLUMNS = ['sku', 'name_ar', 'name_en', 'category', 'unit', 'pricing_model', 'base_price', 'min_quantity', 'is_active', 'is_public', 'description_ar', 'description_en'] as const
const TEMPLATE_ROWS: Record<(typeof COLUMNS)[number], string>[] = [
  { sku: 'FLY-A5', name_ar: 'منشورات A5', name_en: 'A5 flyers', category: 'طباعة', unit: 'sheet', pricing_model: 'per_unit', base_price: '0.08', min_quantity: '100', is_active: 'نعم', is_public: 'نعم', description_ar: '', description_en: '' },
  { sku: 'BC-STD', name_ar: 'بطاقات عمل', name_en: 'Business cards', category: 'طباعة', unit: 'set', pricing_model: 'fixed', base_price: '12', min_quantity: '1', is_active: 'نعم', is_public: 'لا', description_ar: '', description_en: '' },
]

type Truthy = boolean | undefined
const TRUE_WORDS = new Set(['نعم', 'صح', 'yes', 'true', '1', 'y'])
const FALSE_WORDS = new Set(['لا', 'خطأ', 'no', 'false', '0', 'n'])
function parseBool(raw: string): { value: Truthy; error?: string } {
  const v = raw.trim().toLowerCase()
  if (v === '') return { value: undefined }
  if (TRUE_WORDS.has(v)) return { value: true }
  if (FALSE_WORDS.has(v)) return { value: false }
  return { value: undefined, error: 'yesNo' }
}

interface RowResult { line: number; raw: Record<string, string>; input?: ProductInput; errors: string[]; action?: 'create' | 'update' }

/** Validates one CSV row against the exact same field rules the server enforces (@mpe/shared), so nothing importable
 *  here could be rejected later — a mismatch would just move the error from "before import" to "mid-import". */
function validateRow(raw: Record<string, string>, existingSkus: Map<string, ProductRow>): RowResult {
  const errors: string[] = []
  const sku = (raw.sku ?? '').trim()
  if (!sku) errors.push('sku')
  else if (!/^[A-Za-z0-9._-]+$/.test(sku)) errors.push('skuFormat')
  const name_ar = (raw.name_ar ?? '').trim()
  const name_en = (raw.name_en ?? '').trim()
  if (!name_ar) errors.push('name_ar')
  if (!name_en) errors.push('name_en')

  const unit = (raw.unit ?? '').trim() || 'piece'
  if (!(PRODUCT_UNITS as readonly string[]).includes(unit)) errors.push('unit')
  const pricing_model = (raw.pricing_model ?? '').trim() || 'per_unit'
  if (!(PRICING_MODELS as readonly string[]).includes(pricing_model)) errors.push('pricing_model')

  const base_price = (raw.base_price ?? '').trim() || '0'
  if (!decimal.safeParse(base_price).success) errors.push('base_price')
  const min_quantity = (raw.min_quantity ?? '').trim() || '1'
  if (!decimal.safeParse(min_quantity).success || Number(min_quantity) <= 0) errors.push('min_quantity')

  const isActive = parseBool(raw.is_active ?? '')
  const isPublic = parseBool(raw.is_public ?? '')
  if (isActive.error) errors.push('is_active')
  if (isPublic.error) errors.push('is_public')

  const existing = existingSkus.get(sku.toLowerCase())
  if (errors.length > 0) return { line: 0, raw, errors }
  const category = (raw.category ?? '').trim()
  const description_ar = raw.description_ar?.trim()
  const description_en = raw.description_en?.trim()
  return {
    line: 0, raw, errors: [],
    action: existing ? 'update' : 'create',
    input: {
      sku, name_ar, name_en, unit: unit as ProductInput['unit'], pricing_model: pricing_model as ProductInput['pricing_model'],
      base_price, min_quantity,
      // A blank cell means "leave this alone", not "clear it" or "reset it" — importing a price update should never
      // silently wipe a category or description, or flip a product back on/off the website, that an earlier import
      // or a manual edit already set.
      ...(isActive.value !== undefined ? { is_active: isActive.value } : {}),
      ...(isPublic.value !== undefined ? { is_public: isPublic.value } : {}),
      ...(category ? { category } : {}),
      ...(description_ar ? { description_ar } : {}),
      ...(description_en ? { description_en } : {}),
    },
  }
}

function downloadCsv(filename: string, rows: Record<string, string>[]) {
  const csv = Papa.unparse({ fields: [...COLUMNS], data: rows.map((r) => COLUMNS.map((c) => r[c] ?? '')) })
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })   // BOM: Excel opens Arabic correctly
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

/** Bulk product entry from a spreadsheet, for a shop starting from an existing price list instead of typing each
 *  product by hand. Every row is queued through the same offline actions manual entry uses — this is a faster way
 *  to fill the form, not a separate path into the data. */
export function ImportProductsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const can = useCan()
  const products = useLiveQuery(listProducts, [], [] as ProductRow[])
  const fileInput = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<RowResult[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ created: number; updated: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onFile = (file: File) => {
    setError(null); setDone(null); setFileName(file.name)
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        if (result.data.length === 0) { setError('empty'); setRows(null); return }
        if (result.data.length > 2000) { setError('tooMany'); setRows(null); return }
        const existingSkus = new Map(products.map((p) => [p.sku.toLowerCase(), p]))
        const seen = new Set<string>()
        const validated = result.data.map((raw, i): RowResult => {
          const r = validateRow(raw, existingSkus)
          const sku = (raw.sku ?? '').trim().toLowerCase()
          if (sku && seen.has(sku)) return { ...r, line: i + 2, errors: [...r.errors, 'duplicateInFile'] }
          if (sku) seen.add(sku)
          return { ...r, line: i + 2 }
        })
        setRows(validated)
      },
      error: () => { setError('parse'); setRows(null) },
    })
  }

  async function confirmImport() {
    if (!rows) return
    setBusy(true)
    let created = 0, updated = 0
    try {
      for (const r of rows) {
        if (!r.input) continue
        if (r.action === 'update') {
          const existing = products.find((p) => p.sku.toLowerCase() === r.input!.sku.toLowerCase())!
          const changed = await editProduct(existing, { ...r.input })
          if (changed) updated++
        } else {
          await createProduct(r.input)
          created++
        }
      }
      requestSync()
      setDone({ created, updated })
      setRows(null); setFileName('')
      if (fileInput.current) fileInput.current.value = ''
    } finally {
      setBusy(false)
    }
  }

  const valid = rows?.filter((r) => r.errors.length === 0) ?? []
  const invalid = rows?.filter((r) => r.errors.length > 0) ?? []

  return (
    <section className="mx-auto max-w-2xl p-4">
      <button type="button" className="text-sm text-muted underline" onClick={() => navigate(-1)}><span className="arrow-back" aria-hidden="true">←</span> {t('common.back')}</button>
      <h1 className="mt-2 text-2xl font-extrabold">{t('import.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('import.help')}</p>

      <div className="mt-4 flex flex-col gap-2 border border-rule p-3">
        <p className="text-sm font-semibold">{t('import.step1')}</p>
        <button type="button" className={ghostBtn} onClick={() => downloadCsv('mustafa-print-products-template.csv', TEMPLATE_ROWS)}>{t('import.downloadTemplate')}</button>
        {products.length > 0 && (
          <button type="button" className={ghostBtn} onClick={() => downloadCsv('mustafa-print-products-current.csv', products.map((p) => ({
            sku: p.sku, name_ar: p.name_ar, name_en: p.name_en, category: p.category ?? '', unit: p.unit,
            pricing_model: p.pricing_model ?? 'per_unit', base_price: p.base_price, min_quantity: p.min_quantity ?? '1',
            is_active: p.is_active === false ? 'لا' : 'نعم', is_public: p.is_public ? 'نعم' : 'لا',
            description_ar: p.description_ar ?? '', description_en: p.description_en ?? '',
          })))}>{t('import.downloadCurrent')}</button>
        )}
      </div>

      {can('products:write') && (
        <div className="mt-4 flex flex-col gap-2 border border-rule p-3">
          <p className="text-sm font-semibold">{t('import.step2')}</p>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className={inputCls}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} aria-label={t('import.chooseFile')} />
          {fileName && <p className="text-xs text-muted">{fileName}</p>}
          {error && <p role="alert" className="text-sm font-semibold text-magenta">{t(`import.error.${error}`)}</p>}
        </div>
      )}

      {rows && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm">
            {invalid.length === 0
              ? t('import.allValid', { count: valid.length })
              : t('import.someInvalid', { valid: valid.length, invalid: invalid.length })}
          </p>
          {invalid.length > 0 && (
            <ul className="max-h-64 overflow-y-auto border border-rule text-xs">
              {invalid.map((r) => (
                <li key={r.line} className="border-b border-rule px-2 py-1.5">
                  <span className="font-semibold">{t('import.line', { line: r.line })}</span> {r.raw.sku || '—'}: {r.errors.map((e) => t(`import.field.${e}`)).join('، ')}
                </li>
              ))}
            </ul>
          )}
          {valid.length > 0 && (
            <ul className="max-h-64 overflow-y-auto divide-y divide-rule border-y border-rule text-sm">
              {valid.map((r) => (
                <li key={r.line} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{r.input!.name_ar} <span className="text-xs text-muted" dir="ltr">({r.input!.sku})</span></span>
                  <span className={`text-xs font-semibold ${r.action === 'update' ? 'text-cyan' : 'text-ok'}`}>{t(r.action === 'update' ? 'import.willUpdate' : 'import.willCreate')}</span>
                </li>
              ))}
            </ul>
          )}
          {valid.length > 0 && can('products:write') && (
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void confirmImport()}>
              {busy ? t('import.importing') : t('import.confirm', { count: valid.length })}
            </button>
          )}
        </div>
      )}

      {done && <p role="status" className="mt-4 text-sm font-semibold text-ok">{t('import.done', { created: done.created, updated: done.updated })}</p>}
    </section>
  )
}
