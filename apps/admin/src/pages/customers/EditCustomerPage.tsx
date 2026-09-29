import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LOCALES, normalizePhone } from '@mpe/shared'
import { useCan } from '../../auth'
import { InvalidMutationError, editCustomer } from '../../offline/actions'
import { db } from '../../offline/db'
import { DEFAULT_CALLING_CODE } from '../../lib/config'
import { requestSync } from '../../offline/request-sync'
import { cleanDecimal } from '../../offline/order-draft'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

/** Correcting a customer's details. Only the boxes that changed are sent, so two people editing different fields both win. */
export function EditCustomerPage() {
  const { t } = useTranslation()
  const can = useCan()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const customer = useLiveQuery(() => db.customers.get(id), [id])
  // The form is DERIVED from the stored row plus what the person typed. Nothing is copied into state up front,
  // so a change that arrives by sync shows up in the boxes nobody is editing.
  const [edits, setEdits] = useState<Record<string, string | boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (customer === undefined) return <p role="status" className="p-4 text-muted">{t('login.loading')}</p>
  if (!customer) return <section className="p-4"><p>{t('customer.notFound')}</p></section>
  const row = customer                                   // narrowed once, so the save handler below has a certain type

  const form: Record<string, string | boolean> = {
    full_name: row.full_name ?? '', phone_e164: row.phone_e164 ?? '', email: String(row.email ?? ''),
    address_line: String(row.address_line ?? ''), city: String(row.city ?? ''), notes: String(row.notes ?? ''),
    locale: String(row.locale ?? 'ar'), whatsapp_opt_in: Boolean(row.whatsapp_opt_in),
    customer_type: String(row.customer_type ?? 'b2c'), company_name: String(row.company_name ?? ''),
    tax_number: String(row.tax_number ?? ''), credit_limit: String(row.credit_limit ?? ''),
    ...edits,
  }
  const set = (field: string, value: string | boolean) => setEdits((e) => ({ ...e, [field]: value }))
  const isCompany = form.customer_type === 'b2b'

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const name = String(form.full_name).trim()
    if (!name) return setError(t('customer.needName'))

    const typedPhone = String(form.phone_e164).trim()
    const phone = typedPhone ? normalizePhone(typedPhone, DEFAULT_CALLING_CODE) : null
    if (typedPhone && !phone) return setError(t('customer.badPhone'))
    if (!phone && !String(form.email).trim()) return setError(t('customer.needContact'))
    if (String(form.credit_limit).trim() && Number.isNaN(Number(form.credit_limit))) return setError(t('customer.badCreditLimit'))

    // Switching messaging on must record where the consent came from; the shared rules refuse it otherwise.
    const turnedOn = Boolean(form.whatsapp_opt_in) && !row.whatsapp_opt_in
    setBusy(true)
    try {
      const changed = await editCustomer(row, { ...form, phone_e164: phone, ...(turnedOn ? { consent_source: 'in_person' } : {}) })
      if (changed) requestSync()
      navigate(-1)
    } catch (err) {
      setError(err instanceof InvalidMutationError ? t('customer.invalid') : t('common.error'))
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-extrabold">{t('customer.edit')}</h1>
      <form onSubmit={save} className="mt-4 flex flex-col gap-3">
        <label className={labelCls}>{t('customer.name')}<input className={inputCls} value={String(form.full_name)} onChange={(e) => set('full_name', e.target.value)} /></label>
        <label className={labelCls}>{t('customer.phone')}<input className={inputCls} dir="ltr" inputMode="tel" value={String(form.phone_e164)} onChange={(e) => set('phone_e164', e.target.value)} /></label>
        <label className={labelCls}>{t('customer.email')}<input className={inputCls} dir="ltr" inputMode="email" value={String(form.email)} onChange={(e) => set('email', e.target.value)} /></label>
        <label className={labelCls}>{t('customer.address')}<input className={inputCls} value={String(form.address_line)} onChange={(e) => set('address_line', e.target.value)} /></label>
        <label className={labelCls}>{t('newOrder.city')}<input className={inputCls} value={String(form.city)} onChange={(e) => set('city', e.target.value)} /></label>
        <label className={labelCls}>{t('customer.language')}
          <select className={inputCls} value={String(form.locale)} onChange={(e) => set('locale', e.target.value)}>
            {LOCALES.map((l) => <option key={l} value={l}>{l === 'ar' ? 'العربية' : 'English'}</option>)}
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 size-5" checked={Boolean(form.whatsapp_opt_in)} onChange={(e) => set('whatsapp_opt_in', e.target.checked)} />
          <span>{t('customer.whatsapp')}</span>
        </label>
        <label className={labelCls}>{t('customer.notes')}<textarea className={inputCls} rows={2} value={String(form.notes)} onChange={(e) => set('notes', e.target.value)} /></label>

        <fieldset className="flex flex-col gap-3 border border-rule p-3">
          <legend className="px-1 font-semibold">{t('customer.b2b.title')}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-5" checked={isCompany} onChange={(e) => set('customer_type', e.target.checked ? 'b2b' : 'b2c')} />
            <span>{t('customer.b2b.isCompany')}</span>
          </label>
          {isCompany && (
            <>
              <label className={labelCls}>{t('customer.b2b.companyName')}<input className={inputCls} value={String(form.company_name)} onChange={(e) => set('company_name', e.target.value)} /></label>
              <label className={labelCls}>{t('customer.b2b.taxNumber')}<input className={inputCls} dir="ltr" value={String(form.tax_number)} onChange={(e) => set('tax_number', e.target.value)} /></label>
              {can('customers:credit:manage') ? (
                <label className={labelCls}>{t('customer.b2b.creditLimit')}
                  <input className={inputCls} dir="ltr" inputMode="decimal" value={String(form.credit_limit)} onChange={(e) => set('credit_limit', cleanDecimal(e.target.value))} />
                  <span className="text-xs font-normal text-muted">{t('customer.b2b.creditLimitHelp')}</span>
                </label>
              ) : row.credit_limit ? (
                <p className="text-sm text-muted">{t('customer.b2b.creditLimitReadOnly', { amount: row.credit_limit })}</p>
              ) : null}
              <button type="button" className={ghostBtn} onClick={() => navigate(`/customers/${row.id}/pricing`)}>{t('company.pricing.title')} <span className="arrow-go" aria-hidden="true">←</span></button>
              <button type="button" className={ghostBtn} onClick={() => navigate(`/customers/${row.id}/invoices`)}>{t('company.invoices.title')} <span className="arrow-go" aria-hidden="true">←</span></button>
            </>
          )}
        </fieldset>

        {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" className={`${primaryBtn} flex-1`} disabled={busy}>{t('common.save')}</button>
          <button type="button" className={ghostBtn} onClick={() => navigate(-1)}>{t('common.cancel')}</button>
        </div>
      </form>
    </section>
  )
}
