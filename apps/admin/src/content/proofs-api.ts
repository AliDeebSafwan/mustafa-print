import { adminApi } from './call'

const { call } = adminApi('orders')

export interface ProofRow {
  id: string; version: number; public_code: string; original_name: string; kind: 'pdf' | 'jpg' | 'png'
  status: 'pending' | 'approved' | 'changes_requested' | 'superseded'; created_at: string; link: string
  responses: { decision: 'approved' | 'changes_requested'; comment: string | null; responded_at: string }[]
}

/** Proofs are uploaded and read online, like the customer's design files. */
export const proofsApi = {
  list: (orderId: string) => call<ProofRow[]>('GET', `/${orderId}/proofs`),
  upload: (orderId: string, file: File) => { const form = new FormData(); form.append('file', file, file.name); return call<ProofRow>('POST', `/${orderId}/proofs`, form) },
}
