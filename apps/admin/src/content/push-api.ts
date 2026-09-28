import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/admin/push${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ContentError('offline') }
  if (res.status === 204) return undefined as T
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
}

export const pushApi = {
  vapidPublicKey: () => call<{ publicKey: string | null }>('GET', '/vapid-public-key'),
  subscribe: (sub: PushSubscriptionJSON) => call<void>('POST', '/subscribe', sub),
  unsubscribe: (endpoint: string) => call<void>('POST', '/unsubscribe', { endpoint }),
}
