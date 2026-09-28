import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizePhone, toWesternDigits } from '@mpe/shared'
import { createCustomerLocally, searchCustomers } from '../../offline/actions'
import { db, type CustomerRow } from '../../offline/db'
import { DEFAULT_CALLING_CODE } from '../../lib/config'
import { requestSync } from '../../offline/request-sync'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

interface Props { customerId: string | null; onChange: (id: string | null) => void }

/** Searching accepts a few digits, but only a plausibly complete number is treated as the new customer's phone. */
const MIN_PHONE_DIGITS = 6
const digitsOf = (text: string) => toWesternDigits(text).replace(/\D/g, '')

/** Find a customer on this device, or register a new one. Works fully offline. */
export function CustomerPicker({ customerId, onChange }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const selected = useLiveQuery(() => (customerId ? db.customers.get(customerId) : undefined), [customerId])
  const results = useLiveQuery(() => searchCustomers(query), [query], [] as CustomerRow[])

  if (customerId && selected) {
    return (
      <div className="flex items-center justify-between gap-3 border border-ink p-3">
        <div>
          <p className="font-bold">{selected.full_name}</p>
          <p className="text-sm text-muted" dir="ltr">{selected.phone_e164}</p>
        </div>
        <button type="button" className="border border-ink px-3 py-2 text-sm font-semibold" onClick={() => onChange(null)}>{t('customer.change')}</button>
      </div>
    )
  }

  if (creating) {
    return <NewCustomerForm seed={query} onDone={(id) => { setCreating(false); onChange(id) }} onCancel={() => setCreating(false)} />
  }

  const looksLikePhone = digitsOf(query).length >= MIN_PHONE_DIGITS
  return (
    <div>
      <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('customer.search')} aria-label={t('customer.search')}
        autoComplete="off" enterKeyHint="search" />
      {query.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-rule border border-rule">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-3 text-start hover:bg-tint" onClick={() => onChange(c.id)}>
                <span className="font-semibold">{c.full_name}</span>
                <span className="text-sm text-muted" dir="ltr">{c.phone_e164}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">{t('customer.none')}</li>}
        </ul>
      )}
      <button type="button" className={`${ghostBtn} mt-3 w-full`} onClick={() => setCreating(true)}>
        {looksLikePhone ? t('customer.createWithPhone') : t('customer.create')}
      </button>
    </div>
  )
}

function NewCustomerForm({ seed, onDone, onCancel }: { seed: string; onDone: (id: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const seedIsPhone = digitsOf(seed).length >= MIN_PHONE_DIGITS
  const [name, setName] = useState(seedIsPhone || !/\p{L}/u.test(seed) ? '' : seed.trim())          // digits alone are never a name
  const [phone, setPhone] = useState(seedIsPhone ? seed.trim() : '')
  const [whatsapp, setWhatsapp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!name.trim()) return setError(t('customer.needName'))
    const e164 = normalizePhone(phone, DEFAULT_CALLING_CODE)
    if (!e164) return setError(t('customer.badPhone'))
    const { customer, created } = await createCustomerLocally({ fullName: name, phone: e164, whatsappOptIn: whatsapp })
    if (created) requestSync()
    else setNotice(t('customer.existing'))
    onDone(customer.id)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border border-ink p-3">
      <label className={labelCls}>{t('customer.name')}
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
      </label>
      <label className={labelCls}>{t('customer.phone')}
        <input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03 123 456" autoComplete="off" />
        <span className="text-xs font-normal text-muted">{t('customer.phoneHelp')}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-5" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
        <span>{t('customer.whatsapp')}</span>
      </label>
      {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
      {notice && <p role="status" className="text-sm font-semibold text-ok">{notice}</p>}
      <div className="flex gap-2">
        <button type="submit" className={`${primaryBtn} flex-1`}>{t('customer.save')}</button>
        <button type="button" className={ghostBtn} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  )
}
