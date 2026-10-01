// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ API_URL: 'http://localhost:4000', PUBLIC_WEB_URL: 'https://shop.example' as string | null, DEFAULT_CALLING_CODE: '961' }))
const qr = vi.hoisted(() => ({ encoded: [] as string[] }))
vi.mock('../../src/lib/config', () => config)
vi.mock('../../src/lib/qr', () => ({ qrSvg: (text: string) => { qr.encoded.push(text); return '<svg></svg>' } }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null }))

import { LabelPage } from '../../src/pages/orders/LabelPage'
import { createCustomerLocally, createOrderLocally } from '../../src/offline/actions'
import { parseScannedCode } from '../../src/offline/actions/orders'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); qr.encoded.length = 0; config.PUBLIC_WEB_URL = 'https://shop.example' })

async function openLabel() {
  const { customer } = await createCustomerLocally({ fullName: 'Karim Saad', phone: '+96170123456', whatsappOptIn: true })
  const order = await createOrderLocally({ customerId: customer.id, items: [{ name: 'Flyer', quantity: 1, unitPrice: 5 }] })
  renderAt(`/orders/${order.id}/label`, [{ path: '/orders/:id/label', element: <LabelPage /> }])
  await screen.findByText(order.public_code)
  return order
}

describe('the order label', () => {
  it('prints the customer\'s tracking link in the code', async () => {
    const order = await openLabel()
    expect(qr.encoded.at(-1)).toBe(`https://shop.example/ar/track/${order.public_code}`)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('without the website address, holds just the order code (still scannable) and says why, instead of printing a wrong link', async () => {
    config.PUBLIC_WEB_URL = null
    const order = await openLabel()
    expect(qr.encoded.at(-1)).toBe(order.public_code)
    expect(parseScannedCode(qr.encoded.at(-1)!)).toBe(order.public_code)          // the shop's scanner reads it the same way
    expect(screen.getByRole('note').textContent).toMatch(/website address is not set/)
  })
})
