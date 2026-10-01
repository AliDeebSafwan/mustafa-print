import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError } from './api'
import { adminCall } from './admin-call'

export interface OrderFile { id: string; order_item_id: string | null; original_name: string; kind: string; bytes: string; created_at: string }

/**
 * Online-only actions on an order: a customer's design files, and pricing a delivery. Not part of the offline sync
 * contract on purpose — a customer's file is large and belongs to one order, not to every device.
 */
const call = adminCall('/api/v1/admin/orders')

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
