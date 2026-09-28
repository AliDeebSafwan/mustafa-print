import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consentedChannels, MessageError, sendManualMessageLocally } from '../../offline/actions'
import { db, type CustomerRow } from '../../offline/db'
import { requestSync } from '../../offline/request-sync'
import { dateTime } from '../../lib/format'
import { ghostBtn, inputCls } from '../../lib/ui'

const STATUS_LABEL: Record<string, string> = { queued: 'pending', sending: 'pending', sent: 'sent', delivered: 'sent', read: 'sent', failed: 'failed', skipped: 'failed' }

/** A message staff type themselves, and the record of what has already been sent on this order. Works offline: it
 *  queues like any other change and the worker delivers it once the device is back online. */
export function MessagesSection({ orderId, customer, lang }: { orderId: string; customer: CustomerRow; lang: string }) {
  const { t } = useTranslation()
  const logs = useLiveQuery(() => db.notification_logs.where('order_id').equals(orderId).reverse().sortBy('queued_at'), [orderId])
  const channels = consentedChannels(customer)
  const [channel, setChannel] = useState(channels[0])
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send() {
    setError(null)
    if (!channel) return
    if (!body.trim()) return setError(t('messages.compose.empty'))
    setBusy(true)
    try {
      await sendManualMessageLocally({ orderId, channel, body })
      setBody('')
      requestSync()
    } catch (err) {
      setError(err instanceof MessageError && err.code === 'not_consented' ? t('messages.compose.notConsented') : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="mb-2 font-bold">{t('messages.compose.title')}</h2>
      {channels.length === 0 ? (
        <p className="text-sm text-muted">{t('messages.compose.noConsent')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {channels.length > 1 && (
            <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} aria-label={t('messages.compose.channel')}>
              {channels.map((c) => <option key={c} value={c}>{t(`messages.channel.${c}`)}</option>)}
            </select>
          )}
          <textarea className={inputCls} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('messages.compose.placeholder')} maxLength={2000} />
          {error && <p role="alert" className="text-sm font-semibold text-magenta">{error}</p>}
          <button type="button" className={`${ghostBtn} self-start`} disabled={busy} onClick={() => void send()}>{t('messages.compose.send')}</button>
        </div>
      )}

      {logs && logs.length > 0 && (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {logs.map((log) => (
            <li key={log.id} className="py-2.5">
              <p className="whitespace-pre-line text-sm">{log.body}</p>
              <p className="mt-1 text-xs text-muted">
                {t(`messages.channel.${log.channel}`)} · {t(`messages.status.${STATUS_LABEL[log.status] ?? 'pending'}`)} · {dateTime(log.queued_at, lang)}
                {log._pending ? ` · ${t('order.notSynced')}` : ''}
              </p>
              {log.status === 'failed' && log.error_message && <p className="mt-0.5 text-xs text-magenta">{log.error_message}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
