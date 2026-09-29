import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentErrorMessage } from '../site/ContentErrorMessage'
import { ContentError, proofsApi } from '../../content'
import { useResource } from '../../content/use-resource'
import { requestSync } from '../../offline/request-sync'
import { dateTime } from '../../lib/format'
import { ghostBtn } from '../../lib/ui'

/**
 * Send the customer a proof and see every version with their answer. Needs a connection, like the order's files;
 * the order's proof status itself (approved / changes asked) is synced, so the counter sees it offline too.
 */
export function ProofsSection({ orderId, customerPhone, canUpload }: { orderId: string; customerPhone: string | null; canUpload: boolean }) {
  const { t, i18n } = useTranslation()
  const load = useCallback(() => proofsApi.list(orderId), [orderId])
  const { data, error, reload } = useResource(load)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setMessage(null)
    try {
      await proofsApi.upload(orderId, file)
      requestSync()                                   // the order moved to "awaiting approval" on the server
      setMessage({ kind: 'ok', text: t('proofs.uploaded') })
      await reload()
    } catch (err) {
      const detail = err instanceof ContentError ? err.detail : undefined
      setMessage({ kind: 'error', text: detail === 'unsupported_file' ? t('proofs.unsupported') : detail === 'infected_file' ? t('proofs.infected') : detail === 'scanner_unavailable' ? t('proofs.scannerDown') : detail === 'order_past_design' ? t('proofs.pastDesign')
        : detail === 'file_too_large' ? t('proofs.tooLarge') : err instanceof ContentError && err.code === 'offline' ? t('site.error.offline') : t('common.error') })
    } finally {
      setBusy(false)
    }
  }

  const latest = data?.[0]
  const phoneDigits = customerPhone?.replace(/\D/g, '') ?? ''
  return (
    <div>
      <h2 className="mb-2 font-bold">{t('proofs.title')}</h2>
      <ContentErrorMessage error={error} />
      {canUpload && (
        <label className={`${ghostBtn} block cursor-pointer text-center`}>
          {busy ? t('proofs.uploading') : t('proofs.upload')}
          <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
        </label>
      )}
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm font-semibold ${message.kind === 'error' ? 'text-magenta' : 'text-ok'}`}>{message.text}</p>}

      {latest?.status === 'pending' && (
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" className={ghostBtn} onClick={() => void navigator.clipboard?.writeText(latest.link).then(() => setMessage({ kind: 'ok', text: t('proofs.copied') }))}>
            {t('proofs.copyLink')}
          </button>
          {phoneDigits && (
            <a className={`${ghostBtn} text-center`} target="_blank" rel="noopener noreferrer"
              href={`https://wa.me/${phoneDigits}?text=${encodeURIComponent(t('proofs.shareText', { n: latest.version, link: latest.link }))}`}>{t('proofs.sendWhatsapp')}</a>
          )}
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="mt-3 divide-y divide-rule border-y border-rule text-sm">
          {data.map((p) => (
            <li key={p.id} className="py-2.5">
              <p className="flex justify-between gap-3">
                <span className="font-semibold">{t('proofs.version', { n: p.version })} · {p.original_name}</span>
                <span className={p.status === 'approved' ? 'font-bold text-ok' : p.status === 'changes_requested' ? 'font-bold text-magenta' : 'text-muted'}>{t(`proofs.status.${p.status}`)}</span>
              </p>
              <p className="text-xs text-muted">{dateTime(p.created_at, i18n.language)}</p>
              {p.responses.map((r, i) => (
                <p key={i} className="mt-1 text-xs">
                  {t(`proofs.status.${r.decision}`)} · {dateTime(r.responded_at, i18n.language)}{r.comment ? `: «${r.comment}»` : ''}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
