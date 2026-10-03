import { adminApi } from './call'

const { call, blobUrl } = adminApi('orders')

export interface OrderFile { id: string; order_item_id: string | null; original_name: string; kind: string; bytes: string; created_at: string }

export const ordersApi = {
  files: (orderId: string) => call<OrderFile[]>('GET', `/${orderId}/files`),
  /** Revoked by the caller once the download starts. */
  fileUrl: (orderId: string, fileId: string) => blobUrl(`/${orderId}/files/${fileId}`),
  setDeliveryFee: (orderId: string, fee: string) => call<Record<string, unknown>>('POST', `/${orderId}/delivery-fee`, { fee }),
  /** Assigns the order's invoice number if it does not have one yet; reprinting just returns the same one. */
  issueInvoice: (orderId: string) => call<Record<string, unknown>>('POST', `/${orderId}/invoice`, {}),
}
