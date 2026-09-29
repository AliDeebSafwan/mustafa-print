import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { Locale } from '@mpe/shared'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { companyInvoicesApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { asLocale, dateTime, money } from '../../lib/format'
import { ghostBtn, primaryBtn } from '../../lib/ui'

// The printed document's own language, which may differ from the app's (an English invoice for a foreign company).
const T = {
  ar: { title: 'فاتورة مجمّعة', billTo: 'إلى', taxNumber: 'الرقم الضريبي', date: 'التاريخ', order: 'الطلب', net: 'قبل الضريبة', vat: 'الضريبة', total: 'الإجمالي', subtotal: 'المجموع قبل الضريبة', print: 'طباعة', back: 'رجوع' },
  en: { title: 'Consolidated invoice', billTo: 'Bill to', taxNumber: 'Tax number', date: 'Date', order: 'Order', net: 'Net', vat: 'VAT', total: 'Total', subtotal: 'Subtotal', print: 'Print', back: 'Back' },
} as const

/** A consolidated invoice, printable (or print-to-PDF) in either language. Read-only: an issued invoice never changes. */
export function CompanyInvoicePage() {
  const { i18n } = useTranslation()
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const load = useCallback(() => companyInvoicesApi.get(id), [id])
  const { data: inv, error } = useResource(load)
  const [shownLang, setShownLang] = useState<Locale>(asLocale(i18n.language))
  const t = T[shownLang]

  if (!inv) return <section className="mx-auto max-w-2xl p-4"><ContentErrorMessage error={error} /></section>
  const shopName = shownLang === 'en' ? (inv.legal_name_en || inv.name_en) : (inv.legal_name_ar || inv.name_ar)
  const footer = shownLang === 'en' ? inv.invoice_footer_en : inv.invoice_footer_ar
  const hasTax = Number(inv.tax_total) > 0

  return (
    <section className="mx-auto max-w-2xl p-4" dir={shownLang === 'ar' ? 'rtl' : 'ltr'} lang={shownLang}>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button type="button" className="text-sm text-muted underline" onClick={() => navigate(-1)}>{t.back}</button>
        <div className="flex gap-2">
          {(['ar', 'en'] as const).map((l) => (
            <button key={l} type="button" className={`border border-ink px-2 py-1 text-sm ${shownLang === l ? 'bg-ink text-paper' : ''}`} onClick={() => setShownLang(l)}>{l === 'ar' ? 'العربية' : 'English'}</button>
          ))}
        </div>
      </div>

      <header className="mt-4 flex justify-between gap-4 border-b-2 border-ink pb-3">
        <div>
          <p className="text-xl font-extrabold">{shopName}</p>
          {inv.shop_tax_number && <p className="text-sm">{t.taxNumber}: <span dir="ltr">{inv.shop_tax_number}</span></p>}
        </div>
        <div className="text-end">
          <p className="text-xl font-extrabold">{t.title}</p>
          <p className="font-semibold" dir="ltr">#{inv.invoice_number}</p>
          <p className="text-sm">{t.date}: {dateTime(inv.issued_at, shownLang)}</p>
        </div>
      </header>

      <div className="mt-4">
        <p className="text-sm text-muted">{t.billTo}</p>
        <p className="font-bold">{inv.company_name || inv.full_name}</p>
        {inv.customer_tax_number && <p className="text-sm">{t.taxNumber}: <span dir="ltr">{inv.customer_tax_number}</span></p>}
        {(inv.address_line || inv.city) && <p className="text-sm">{[inv.address_line, inv.city].filter(Boolean).join('، ')}</p>}
      </div>

      <table className="mt-6 w-full text-sm">
        <thead><tr className="border-b-2 border-ink">
          <th className="py-1.5 text-start">{t.order}</th><th className="py-1.5 text-start">{t.date}</th>
          {hasTax && <th className="py-1.5 text-end">{t.net}</th>}{hasTax && <th className="py-1.5 text-end">{t.vat}</th>}
          <th className="py-1.5 text-end">{t.total}</th>
        </tr></thead>
        <tbody>
          {inv.orders.map((o) => (
            <tr key={o.id} className="border-b border-rule">
              <td className="py-1.5" dir="ltr">#{o.order_number ?? o.public_code}</td>
              <td className="py-1.5">{dateTime(o.placed_at, shownLang)}</td>
              {hasTax && <td className="py-1.5 text-end" dir="ltr">{money(o.net, inv.currency)}</td>}
              {hasTax && <td className="py-1.5 text-end" dir="ltr">{money(o.tax_total, inv.currency)}</td>}
              <td className="py-1.5 text-end font-semibold" dir="ltr">{money(o.total, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ms-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {hasTax && <><dt>{t.subtotal}</dt><dd className="text-end" dir="ltr">{money(inv.subtotal, inv.currency)}</dd></>}
        {hasTax && <><dt>{t.vat} ({Number(inv.vat_rate_percent)}%)</dt><dd className="text-end" dir="ltr">{money(inv.tax_total, inv.currency)}</dd></>}
        <dt className="text-lg font-extrabold">{t.total}</dt><dd className="text-end text-lg font-extrabold" dir="ltr">{money(inv.total, inv.currency)}</dd>
      </dl>
      {footer && <p className="mt-8 border-t border-rule pt-3 text-center text-xs whitespace-pre-line">{footer}</p>}

      <div className="mt-6 flex gap-2 print:hidden">
        <button type="button" className={`${primaryBtn} flex-1`} onClick={() => window.print()}>{t.print}</button>
        <button type="button" className={ghostBtn} onClick={() => navigate(-1)}>{t.back}</button>
      </div>
    </section>
  )
}
