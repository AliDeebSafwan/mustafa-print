// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'staff', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({ proofs: [] as Record<string, unknown>[], listCalls: 0, uploads: [] as unknown[][], failUpload: null as null | string }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    ordersApi: { files: async () => [] },
    proofsApi: {
      list: async () => { server.listCalls++; return server.proofs },
      upload: async (...args: unknown[]) => {
        server.uploads.push(args)
        if (server.failUpload) throw new actual.ContentError('invalid_request', server.failUpload)
        const row = { id: 'p1', version: 1, public_code: 'PROOFCODE123', original_name: 'banner.png', kind: 'png', status: 'pending', created_at: '2026-01-01T10:00:00Z', link: 'https://print.example.com/ar/proof/PROOFCODE123', responses: [] }
        server.proofs = [row]
        return row
      },
    },
  }
})

import { OrderDetailPage } from '../../src/pages/OrderDetailPage'
import { OrdersPage } from '../../src/pages/OrdersPage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { db } from '../../src/offline/db'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  Object.assign(server, { proofs: [], listCalls: 0, uploads: [], failUpload: null })
})
async function seed(over: Record<string, unknown> = {}) {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Banner', quantity: 1, unitPrice: 50 }] })
  await db.orders.update(order.id, { _pending: false, ...over })
  return order
}
const detail = (id: string) => renderAt(`/orders/${id}`, [{ path: '/orders/:id', element: <OrderDetailPage /> }])

describe('proofs on the order screen', () => {
  it('an order without a proof makes no network call; the section opens on request', async () => {
    const order = await seed()
    const user = userEvent.setup()
    detail(order.id)
    await user.click(await screen.findByRole('button', { name: 'Send a proof to the customer' }))
    expect(await screen.findByText('Upload a proof for the customer (image or PDF)')).toBeTruthy()
    expect(server.listCalls).toBe(1)
  })

  it('does not even ask the server when the screen simply opens', async () => {
    const order = await seed()
    detail(order.id)
    await screen.findByRole('button', { name: 'Send a proof to the customer' })
    expect(server.listCalls).toBe(0)
  })

  it('uploads a proof and offers the link on WhatsApp', async () => {
    const order = await seed()
    const user = userEvent.setup()
    const { container } = detail(order.id)
    await user.click(await screen.findByRole('button', { name: 'Send a proof to the customer' }))
    await screen.findByText('Upload a proof for the customer (image or PDF)')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'banner.png', { type: 'image/png' }))
    expect(await screen.findByText('Proof uploaded. Send the link to the customer.')).toBeTruthy()
    expect(server.uploads[0]![0]).toBe(order.id)
    const wa = await screen.findByRole('link', { name: 'Send it on WhatsApp' })
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('https://print.example.com/ar/proof/PROOFCODE123')
  })

  it('explains a refused file in plain words', async () => {
    server.failUpload = 'unsupported_file'
    const order = await seed()
    const user = userEvent.setup()
    const { container } = detail(order.id)
    await user.click(await screen.findByRole('button', { name: 'Send a proof to the customer' }))
    await screen.findByText('Upload a proof for the customer (image or PDF)')
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['not really an image'], 'renamed.png', { type: 'image/png' }))   // the server reads the bytes and refuses
    expect((await screen.findByRole('alert')).textContent).toBe('A proof must be a PDF or a PNG/JPG image a phone can open.')
  })

  it('shows the customer\'s answer, with every version on record', async () => {
    server.proofs = [
      { id: 'p2', version: 2, public_code: 'B', original_name: 'v2.png', kind: 'png', status: 'approved', created_at: '2026-01-02T10:00:00Z', link: 'x', responses: [{ decision: 'approved', comment: null, responded_at: '2026-01-02T11:00:00Z' }] },
      { id: 'p1', version: 1, public_code: 'A', original_name: 'v1.png', kind: 'png', status: 'changes_requested', created_at: '2026-01-01T10:00:00Z', link: 'y', responses: [{ decision: 'changes_requested', comment: 'Bigger logo', responded_at: '2026-01-01T12:00:00Z' }] },
    ]
    const order = await seed({ status: 'awaiting_approval', proof_status: 'approved' })
    detail(order.id)
    expect(await screen.findByText('The customer approved the proof. Move the order to printing when ready.')).toBeTruthy()
    expect(await screen.findByText(/Bigger logo/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copy the proof link' })).toBeNull()   // nothing left to send
  })
})

describe('the orders list', () => {
  it('flags an order whose customer approved the proof, even offline', async () => {
    await seed({ status: 'awaiting_approval', proof_status: 'approved' })
    renderAt('/', [{ path: '/', element: <OrdersPage /> }])
    expect(await screen.findByText('Customer approved the proof')).toBeTruthy()
    expect(server.listCalls).toBe(0)
  })
})
