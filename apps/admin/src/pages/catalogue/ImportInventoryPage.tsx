import Papa from 'papaparse'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { INVENTORY_CATEGORIES, INVENTORY_UNITS, decimal } from '@mpe/shared'
import { useCan } from '../../auth'
import { createInventoryItem, editInventoryItem, listInventory, recordMovement, type InventoryItemInput } from '../../offline/actions'
import type { InventoryRow } from '../../offline/db'
import { requestSync } from '../../offline/request-sync'
import { ghostBtn, inputCls, primaryBtn } from '../../lib/ui'

const COLUMNS = ['sku', 'name_ar', 'name_en', 'category', 'unit', 'reorder_level', 'reorder_quantity', 'cost_per_unit', 'supplier_name', 'opening_balance'] as const
const TEMPLATE_ROWS: Record<(typeof COLUMNS)[number], string>[] = [
  { sku: 'PAPER-A4-80', name_ar: 'ورق A4 80غ', name_en: 'A4 paper 80g', category: 'paper', unit: 'ream', reorder_level: '10', reorder_quantity: '20', cost_per_unit: '3.5', supplier_name: '', opening_balance: '50' },
  { sku: 'INK-CMYK-K', name_ar: 'حبر أسود', name_en: 'Black ink', category: 'ink', unit: 'liter', reorder_level: '2', reorder_quantity: '', cost_per_unit: '', supplier_name: '', opening_balance: '5' },
]

interface RowResult { line: number; raw: Record<string, string>; input?: InventoryItemInput; opening?: string; errors: string[]; action?: 'create' | 'update' }

/** Validates one CSV row against the exact same field rules the server enforces (@mpe/shared). An opening balance
 *  only ever applies to a brand new item — re-importing to update prices never re-adds stock that already exists. */
function validateRow(raw: Record<string, string>, existingSkus: Map<string, InventoryRow>): RowResult {
  const errors: string[] = []
  const sku = (raw.sku ?? '').trim()
  if (!sku) errors.push('sku')
  else if (!/^[A-Za-z0-9._-]+$/.test(sku)) errors.push('skuFormat')
  const name_ar = (raw.name_ar ?? '').trim()
  const name_en = (raw.name_en ?? '').trim()
  if (!name_ar) errors.push('name_ar')
  if (!name_en) errors.push('name_en')

  const category = (raw.category ?? '').trim()
  if (!(INVENTORY_CATEGORIES as readonly string[]).includes(category)) errors.push('category')
  const unit = (raw.unit ?? '').trim()
  if (!(INVENTORY_UNITS as readonly string[]).includes(unit)) errors.push('unit')

  const reorder_level = (raw.reorder_level ?? '').trim() || '0'
  if (!decimal.safeParse(reorder_level).success) errors.push('reorder_level')
  const reorder_quantity = (raw.reorder_quantity ?? '').trim()
  if (reorder_quantity && (!decimal.safeParse(reorder_quantity).success || Number(reorder_quantity) <= 0)) errors.push('reorder_quantity')
  const cost_per_unit = (raw.cost_per_unit ?? '').trim()
  if (cost_per_unit && !decimal.safeParse(cost_per_unit).success) errors.push('cost_per_unit')
  const opening_balance = (raw.opening_balance ?? '').trim()
  if (opening_balance && (!decimal.safeParse(opening_balance).success || Number(opening_balance) <= 0)) errors.push('opening_balance')

  const existing = existingSkus.get(sku.toLowerCase())
  if (errors.length > 0) return { line: 0, raw, errors }
  const supplier_name = raw.supplier_name?.trim()
  return {
    line: 0, raw, errors: [],
    action: existing ? 'update' : 'create',
    opening: !existing && opening_balance ? opening_balance : undefined,
    input: {
      sku, name_ar, name_en, category, unit,
      // A blank cell means "leave this alone" on an update — importing a restock file should never silently reset
      // a reorder point or supplier someone already set up.
      ...(reorder_level !== '0' || !existing ? { reorder_level } : {}),
      ...(reorder_quantity ? { reorder_quantity } : {}),
      ...(cost_per_unit ? { cost_per_unit } : {}),
      ...(supplier_name ? { supplier_name } : {}),
    },
  }
}

function downloadCsv(filename: string, rows: Record<string, string>[]) {
  const csv = Papa.unparse({ fields: [...COLUMNS], data: rows.map((r) => COLUMNS.map((c) => r[c] ?? '')) })
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

/** Bulk stock-item entry from a spreadsheet, including the opening balance so the ledger starts accurate instead of
 *  from zero. Every row goes through the same offline actions the store screen uses — a faster way to fill the
 *  form, not a separate path into the data. */
export function ImportInventoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const can = useCan()
  const items = useLiveQuery(listInventory, [], [] as InventoryRow[])
  const fileInput = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<RowResult[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ created: number; updated: number; stocked: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onFile = (file: File) => {
    setError(null); setDone(null); setFileName(file.name)
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        if (result.data.length === 0) { setError('empty'); setRows(null); return }
        if (result.data.length > 2000) { setError('tooMany'); setRows(null); return }
        const existingSkus = new Map(items.map((it) => [it.sku.toLowerCase(), it]))
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
    let created = 0, updated = 0, stocked = 0
    try {
      for (const r of rows) {
        if (!r.input) continue
        if (r.action === 'update') {
          const existing = items.find((it) => it.sku.toLowerCase() === r.input!.sku.toLowerCase())!
          const changed = await editInventoryItem(existing, { ...r.input })
          if (changed) updated++
        } else {
          const row = await createInventoryItem(r.input)
          created++
          if (r.opening) { await recordMovement({ itemId: row.id, type: 'opening_balance', amount: r.opening, reason: 'استيراد أولي' }); stocked++ }
        }
      }
      requestSync()
      setDone({ created, updated, stocked })
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
      <h1 className="mt-2 text-2xl font-extrabold">{t('importInv.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('importInv.help')}</p>

      <div className="mt-4 flex flex-col gap-2 border border-rule p-3">
        <p className="text-sm font-semibold">{t('import.step1')}</p>
        <button type="button" className={ghostBtn} onClick={() => downloadCsv('mustafa-print-inventory-template.csv', TEMPLATE_ROWS)}>{t('import.downloadTemplate')}</button>
        {items.length > 0 && (
          <button type="button" className={ghostBtn} onClick={() => downloadCsv('mustafa-print-inventory-current.csv', items.map((it) => ({
            sku: it.sku, name_ar: it.name_ar, name_en: it.name_en, category: it.category ?? '', unit: it.unit,
            reorder_level: it.reorder_level ?? '0', reorder_quantity: it.reorder_quantity ?? '', cost_per_unit: it.cost_per_unit ?? '',
            supplier_name: it.supplier_name ?? '', opening_balance: '',
          })))}>{t('importInv.downloadCurrent')}</button>
        )}
      </div>

      {can('inventory:manage') && (
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
                  <span className="font-semibold">{t('import.line', { line: r.line })}</span> {r.raw.sku || '—'}: {r.errors.map((e) => t(`importInv.field.${e}`, { defaultValue: t(`import.field.${e}`) })).join('، ')}
                </li>
              ))}
            </ul>
          )}
          {valid.length > 0 && (
            <ul className="max-h-64 overflow-y-auto divide-y divide-rule border-y border-rule text-sm">
              {valid.map((r) => (
                <li key={r.line} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{r.input!.name_ar} <span className="text-xs text-muted" dir="ltr">({r.input!.sku})</span></span>
                  <span className={`text-xs font-semibold ${r.action === 'update' ? 'text-cyan' : 'text-ok'}`}>
                    {t(r.action === 'update' ? 'import.willUpdate' : 'import.willCreate')}{r.opening ? ` · ${t('importInv.opensWith', { amount: r.opening })}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {valid.length > 0 && can('inventory:manage') && (
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void confirmImport()}>
              {busy ? t('import.importing') : t('import.confirm', { count: valid.length })}
            </button>
          )}
        </div>
      )}

      {done && <p role="status" className="mt-4 text-sm font-semibold text-ok">{t('importInv.done', { created: done.created, updated: done.updated, stocked: done.stocked })}</p>}
    </section>
  )
}
