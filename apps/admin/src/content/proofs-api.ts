import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, type ContentErrorCode } from './api'

export interface ProofRow {
  id: string; version: number; public_code: string; original_name: string; kind: 'pdf' | 'jpg' | 'png'
  status: 'pending' | 'approved' | 'changes_requested' | 'superseded'; created_at: string; link: string
  responses: { decision: 'approved' | 'changes_requested'; comment: string | null; responded_at: string }[]
}

async function send<T>(method: string, orderId: string, body?: FormData): Promise<T> {
  const token = await auth.getAccessToken()
  if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/admin/orders/${orderId}/proofs`, { method, headers: { Authorization: `Bearer ${token}` }, body })
  } catch { throw new ContentError('offline') }
  const payload = (await res.json().catch(() => null)) as { error?: ContentErrorCode; message?: string } | null
  if (!res.ok) throw new ContentError(payload?.error ?? 'server', payload?.message)
  return payload as T
}

/** Proofs are uploaded and read online, like the customer's design files. */
export const proofsApi = {
  list: (orderId: string) => send<ProofRow[]>('GET', orderId),
  upload: (orderId: string, file: File) => { const form = new FormData(); form.append('file', file, file.name); return send<ProofRow>('POST', orderId, form) },
}
