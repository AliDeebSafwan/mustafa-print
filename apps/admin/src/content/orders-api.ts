import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

export interface OrderFile { id: string; order_item_id: string | null; original_name: string; kind: string; bytes: string; created_at: string }

/**
 * Online-only actions on an order: a customer's design files, and pricing a delivery. Not part of the offline sync
 * contract on purpose — a customer's file is large and belongs to one order, not to every device.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/admin/orders${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ContentError('offline') }
  if (res.status === 204) return undefined as T
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
}

export const ordersApi = {
  files: (orderId: string) => call<OrderFile[]>('GET', `/${orderId}/files`),
  fileUrl: async (orderId: string, fileId: string): Promise<string> => {
    const token = await auth.getAccessToken()
    if (!token) throw new ContentError('unauthorized')
    const res = await fetch(`${API_URL}/api/v1/admin/orders/${orderId}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new ContentError('server')
    return URL.createObjectURL(await res.blob())            // revoked by the caller once the download starts
  },
  setDeliveryFee: (orderId: string, fee: string) => call<Record<string, unknown>>('POST', `/${orderId}/delivery-fee`, { fee }),
  /** Assigns the order's invoice number if it does not have one yet; reprinting just returns the same one. */
  issueInvoice: (orderId: string) => call<Record<string, unknown>>('POST', `/${orderId}/invoice`, {}),
}
