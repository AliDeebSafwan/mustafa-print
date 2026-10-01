import { pushApi } from '../content'

export type PushSupport = 'unsupported' | 'denied' | 'not-subscribed' | 'subscribed'

/** Whether this browser can even do Web Push, and if so, whether this device is currently subscribed. */
export async function pushStatus(): Promise<PushSupport> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'subscribed' : 'not-subscribed'
}

/**
 * The server's VAPID public key arrives as base64url text; the browser's push subscription wants its raw bytes
 * (applicationServerKey, per the Web Push standard). Decoding a public key, nothing more.
 */
function base64UrlToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Asks the browser for permission (if needed), subscribes this device, and tells the server. Throws if the person
 *  declines the permission prompt or the server has no VAPID key configured yet. */
export async function enablePush(): Promise<void> {
  const { publicKey } = await pushApi.vapidPublicKey()
  if (!publicKey) throw new Error('push_not_configured')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission_denied')
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })
  await pushApi.subscribe(sub.toJSON() as PushSubscriptionJSON)
}

/** Unsubscribes this device, on the browser and on the server, in that order — if the server call fails, the
 *  browser subscription is gone regardless, matching what the person now sees in the UI. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await pushApi.unsubscribe(endpoint).catch(() => undefined)
}
