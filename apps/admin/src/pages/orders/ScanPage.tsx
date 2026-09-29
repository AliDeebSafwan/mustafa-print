import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ORDER_STATUS_LABELS, allowedNextStatuses, isLocale, isOrderStatus, roleDefinition, type OrderStatus } from '@mpe/shared'
import { useAuth } from '../../auth'
import { changeOrderStatus, findOrderByCode } from '../../offline/actions'
import type { OrderRow } from '../../offline/db'
import { db } from '../../offline/db'

/**
 * Lookup happens against the LOCAL database, so scanning works with no internet.
 * Camera scanning uses the BarcodeDetector API (Chromium/Android). Where it is missing (e.g. iOS Safari) the typed
 * code still works; add a JS decoder such as @zxing/browser if those devices must scan with the camera.
 */
export function ScanPage() {
  const { t, i18n } = useTranslation()
  const lang = isLocale(i18n.language) ? i18n.language : 'ar'
  const auth = useAuth()
  const role = auth.status === 'signed_in' ? roleDefinition(auth.user.role) : undefined
  const [code, setCode] = useState('')
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  async function lookup(raw: string, source: 'scanner' | 'manual' = 'manual') {
    const found = await findOrderByCode(raw)
    if (!found) { setOrder(null); setMessage({ kind: 'error', text: t('scan.notFound') }); return }
    setMessage(null)
    setOrder(found)
    if (source === 'scanner') setCode(raw)
  }

  useEffect(() => {
    if (!cameraOn || !supported || !videoRef.current) return
    const video = videoRef.current
    const detector = new window.BarcodeDetector!({ formats: ['qr_code', 'code_128'] })
    let stream: MediaStream | undefined
    let raf = 0
    let stopped = false
    ;(async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      video.srcObject = stream
      await video.play()
      const tick = async () => {
        if (stopped) return
        try {
          const [hit] = await detector.detect(video)
          if (hit) { setCameraOn(false); await lookup(hit.rawValue, 'scanner'); return }
        } catch { /* a frame that cannot be decoded is normal */ }
        raf = requestAnimationFrame(tick)
      }
      void tick()
    })().catch(() => { setCameraOn(false); setMessage({ kind: 'error', text: t('scan.cameraDenied') }) })
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((tr) => tr.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn])

  async function move(to: OrderStatus) {
    if (!order) return
    await changeOrderStatus(order, to, { source: code ? 'scanner' : 'manual', barcode: code || undefined })
    setOrder((await db.orders.get(order.id)) ?? null)
    setMessage({ kind: 'ok', text: t('scan.moved') })
  }

  const next = order && role && isOrderStatus(order.status) ? allowedNextStatuses(role, order.status) : []

  return (
    <section className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-extrabold">{t('scan.title')}</h1>

      {supported ? (
        <div className="mt-4">
          {cameraOn && <video ref={videoRef} playsInline muted className="aspect-square w-full bg-ink object-cover" />}
          <button className="mt-3 w-full bg-ink py-3 font-bold text-white" onClick={() => setCameraOn((v) => !v)}>
            {cameraOn ? t('scan.stopCamera') : t('scan.camera')}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{t('scan.cameraUnsupported')}</p>
      )}

      <form className="mt-6" onSubmit={(e: FormEvent) => { e.preventDefault(); void lookup(code) }}>
        <label htmlFor="scan-code" className="text-sm font-semibold">{t('scan.manual')}</label>
        <div className="mt-1 flex gap-2">
          <input id="scan-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('scan.placeholder')} autoCapitalize="characters" autoComplete="off" spellCheck={false}
            className="h-12 min-w-0 flex-1 border border-ink px-3 font-mono uppercase tracking-widest" />
          <button className="h-12 bg-magenta px-6 font-bold text-white" type="submit">{t('scan.find')}</button>
        </div>
      </form>

      {message && <p role="status" className={`mt-4 font-semibold ${message.kind === 'error' ? 'text-magenta' : 'text-ok'}`}>{message.text}</p>}

      {order && isOrderStatus(order.status) && (
        <div className="mt-6 border border-ink p-4">
          <p className="text-sm text-muted">{order.order_number ? `#${order.order_number}` : order.public_code}</p>
          <p className="text-xl font-extrabold">{ORDER_STATUS_LABELS[order.status][lang]}</p>
          <p className="mt-4 text-sm font-semibold">{t('scan.moveTo')}</p>
          {next.length === 0 ? <p className="mt-1 text-muted">{t('scan.noMoves')}</p> : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {next.map((s) => <button key={s} className="border border-ink py-3 font-semibold hover:bg-tint" onClick={() => void move(s)}>{ORDER_STATUS_LABELS[s][lang]}</button>)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
