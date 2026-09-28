import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { db } from '../offline/db'
import { PUBLIC_WEB_URL } from '../lib/config'
import { asLocale, dateTime } from '../lib/format'
import { qrSvg } from '../lib/qr'
import { ghostBtn, primaryBtn } from '../lib/ui'

/**
 * The sticker for the job bag. The QR holds the customer's tracking link; the staff scanner reads the code out of it.
 * Generated on the device, so it can be printed with no internet.
 */
export function LabelPage() {
  const { t, i18n } = useTranslation()
  const { id = '' } = useParams()
  const data = useLiveQuery(async () => {
    const order = await db.orders.get(id)
    return { order, customer: order ? await db.customers.get(order.customer_id) : undefined }
  }, [id])
  if (!data) return null
  const { order, customer } = data
  if (!order) return <section className="p-4"><p>{t('order.notFound')}</p></section>

  const trackingLang = customer?.locale === 'en' ? 'en' : 'ar'
  const url = `${PUBLIC_WEB_URL}/${trackingLang}/track/${order.public_code}`
  return (
    <section className="mx-auto max-w-sm p-4">
      <div className="mx-auto flex w-full max-w-[16rem] flex-col items-center gap-2 border-2 border-ink p-4 text-center print:border-0">
        <div className="w-full" aria-label={t('label.qrAlt')} role="img" dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
        <p className="text-3xl font-extrabold" dir="ltr">{order.order_number ? `#${order.order_number}` : '—'}</p>
        <p className="font-mono text-lg font-bold tracking-widest" dir="ltr">{order.public_code}</p>
        <p className="font-semibold">{customer?.full_name}</p>
        <p className="text-xs text-muted">{dateTime(order.placed_at, asLocale(i18n.language))}</p>
        {!order.order_number && <p className="text-xs text-muted print:hidden">{t('label.pending')}</p>}
      </div>
      <div className="mt-4 flex gap-2 print:hidden">
        <button className={`${primaryBtn} flex-1`} onClick={() => window.print()}>{t('label.print')}</button>
        <Link to={`/orders/${order.id}`} className={ghostBtn}>{t('order.back')}</Link>
      </div>
    </section>
  )
}
