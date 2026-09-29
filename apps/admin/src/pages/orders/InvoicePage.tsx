import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { formatCents, toCents, type Locale } from '@mpe/shared'
import { useBranch } from '../../auth'
import { ContentError, ordersApi } from '../../content'
import { db } from '../../offline/db'
import { requestSync } from '../../offline/request-sync'
import { asLocale, dateTime, money } from '../../lib/format'
import { ghostBtn, primaryBtn } from '../../lib/ui'

const T = {
  ar: {
    invoice: 'فاتورة', notInvoiced: 'لم تُصدر بعد', issue: 'إصدار وطباعة', print: 'طباعة', back: 'رجوع', pending: 'بانتظار الإصدار',
    billTo: 'إلى', order: 'رقم الطلب', date: 'التاريخ', item: 'الصنف', qty: 'الكمية', unitPrice: 'سعر الوحدة', lineTotal: 'المجموع',
    subtotal: 'المجموع الفرعي', discount: 'الخصم', delivery: 'التوصيل', vat: 'ضريبة القيمة المضافة', total: 'الإجمالي',
    paid: 'المدفوع', due: 'المتبقي', taxNumber: 'الرقم الضريبي', offline: 'لا يوجد اتصال بالإنترنت. الإصدار يحتاج اتصالاً.', error: 'تعذّر الإصدار. حاول مجدداً.',
  },
  en: {
    invoice: 'Invoice', notInvoiced: 'Not yet issued', issue: 'Issue and print', print: 'Print', back: 'Back', pending: 'Waiting to be issued',
    billTo: 'Bill to', order: 'Order', date: 'Date', item: 'Item', qty: 'Qty', unitPrice: 'Unit price', lineTotal: 'Line total',
    subtotal: 'Subtotal', discount: 'Discount', delivery: 'Delivery', vat: 'VAT', total: 'Total',
    paid: 'Paid', due: 'Balance due', taxNumber: 'Tax number', offline: 'No internet connection. Issuing needs one.', error: 'Could not issue the invoice. Try again.',
  },
} as const

/** A printed (or print-to-PDF) invoice. The invoice number is assigned once, online, then rendered offline like any other order data. */
export function InvoicePage() {
  const { i18n } = useTranslation()
  const { id = '' } = useParams()
  const branch = useBranch()
  const [lang, setLang] = useState<Locale | null>(null)   // null until the customer's own language is known
  const [issuing, setIssuing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const data = useLiveQuery(async () => {
    const order = await db.orders.get(id)
    if (!order) return { order: undefined }
    const [customer, items] = await Promise.all([db.customers.get(order.customer_id), db.order_items.where('order_id').equals(id).sortBy('sort_order')])
    return { order, customer, items }
  }, [id])

  if (!data) return null
  const { order, customer, items = [] } = data
  const shownLang: Locale = lang ?? asLocale(customer?.locale ?? i18n.language)
  const t = T[shownLang]
  if (!order) return <section className="p-4"><p>{t.back}</p></section>

  async function issue() {
    setError(null)
    setIssuing(true)
    try {
      const saved = await ordersApi.issueInvoice(order!.id)
      await db.orders.update(order!.id, saved)   // show the fresh number immediately, no round trip needed
      requestSync()
      setTimeout(() => window.print(), 150)       // let the number render before the print dialog opens
    } catch (err) {
      setError(err instanceof ContentError && err.code === 'offline' ? t.offline : t.error)
    } finally {
      setIssuing(false)
    }
  }

  const totalCents = toCents(order.total) ?? 0
  const paidCents = toCents(order.paid_total ?? '0') ?? 0
  const due = Math.max(0, totalCents - paidCents)
  const legalName = shownLang === 'en' ? (branch?.legalNameEn || branch?.nameEn) : (branch?.legalNameAr || branch?.nameAr)
  const footer = shownLang === 'en' ? branch?.invoiceFooterEn : branch?.invoiceFooterAr

  return (
    <section className="mx-auto max-w-xl p-4" dir={shownLang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <div className="flex gap-1 text-sm font-semibold">
          <button type="button" className={`border border-ink px-2 py-1 ${shownLang === 'ar' ? 'bg-ink text-white' : ''}`} onClick={() => setLang('ar')}>عربي</button>
          <button type="button" className={`border border-ink px-2 py-1 ${shownLang === 'en' ? 'bg-ink text-white' : ''}`} onClick={() => setLang('en')}>English</button>
        </div>
        <Link to={`/orders/${order.id}`} className={ghostBtn}>{t.back}</Link>
      </div>

      <header className="mt-4 flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
        <div>
          <p className="text-xl font-extrabold">{legalName}</p>
          {branch?.taxNumber && <p className="text-sm text-muted">{t.taxNumber}: <span dir="ltr">{branch.taxNumber}</span></p>}
        </div>
        <div className="text-end">
          <p className="text-lg font-extrabold">{t.invoice}</p>
          <p className="font-mono text-lg font-bold" dir="ltr">{order.invoice_number ? `#${order.invoice_number}` : t.notInvoiced}</p>
          {order.invoice_issued_at && <p className="text-xs text-muted">{dateTime(order.invoice_issued_at, shownLang)}</p>}
        </div>
      </header>

      <div className="mt-4 flex justify-between gap-4 text-sm">
        <div>
          <p className="text-muted">{t.billTo}</p>
          <p className="font-semibold">{customer?.full_name}</p>
          {customer?.phone_e164 && <p dir="ltr">{customer.phone_e164}</p>}
          {customer?.email && <p dir="ltr">{customer.email}</p>}
        </div>
        <div className="text-end">
          <p className="text-muted">{t.order}: <span className="font-semibold text-ink" dir="ltr">{order.order_number ? `#${order.order_number}` : order.public_code}</span></p>
          <p className="text-muted">{t.date}: {dateTime(order.placed_at, shownLang)}</p>
        </div>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-start">
            <th className="py-1.5 text-start font-bold">{t.item}</th>
            <th className="py-1.5 text-end font-bold">{t.qty}</th>
            <th className="py-1.5 text-end font-bold">{t.unitPrice}</th>
            <th className="py-1.5 text-end font-bold">{t.lineTotal}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-rule">
              <td className="py-1.5">{item.name_snapshot}</td>
              <td className="py-1.5 text-end" dir="ltr">{Number(item.quantity)}</td>
              <td className="py-1.5 text-end" dir="ltr">{money(item.unit_price, '')}</td>
              <td className="py-1.5 text-end font-semibold" dir="ltr">{money(item.line_total, '')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-4 ms-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{t.subtotal}</dt><dd className="text-end" dir="ltr">{money(order.subtotal, order.currency)}</dd>
        {Number(order.discount_total ?? 0) > 0 && (<><dt className="text-muted">{t.discount}</dt><dd className="text-end" dir="ltr">−{money(order.discount_total, order.currency)}</dd></>)}
        {Number(order.delivery_fee ?? 0) > 0 && (<><dt className="text-muted">{t.delivery}</dt><dd className="text-end" dir="ltr">{money(order.delivery_fee, order.currency)}</dd></>)}
        {Number(order.tax_total ?? 0) > 0 && (
          <><dt className="text-muted">{t.vat} ({Number(branch?.vatRatePercent ?? 0)}%)</dt><dd className="text-end" dir="ltr">{money(order.tax_total, order.currency)}</dd></>
        )}
        <dt className="text-lg font-extrabold">{t.total}</dt><dd className="text-end text-lg font-extrabold" dir="ltr">{money(order.total, order.currency)}</dd>
        <dt className="text-muted">{t.paid}</dt><dd className="text-end" dir="ltr">{money(order.paid_total, order.currency)}</dd>
        {due > 0 && <><dt className="font-bold">{t.due}</dt><dd className="text-end font-bold" dir="ltr">{money(formatCents(due), order.currency)}</dd></>}
      </dl>

      {footer && <p className="mt-6 whitespace-pre-line border-t border-rule pt-3 text-sm text-muted">{footer}</p>}

      <div className="mt-6 flex flex-col gap-2 print:hidden">
        {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
        {order.invoice_number ? (
          <button type="button" className={primaryBtn} onClick={() => window.print()}>{t.print}</button>
        ) : (
          <button type="button" className={primaryBtn} disabled={issuing} onClick={() => void issue()}>{issuing ? t.pending : t.issue}</button>
        )}
      </div>
    </section>
  )
}
