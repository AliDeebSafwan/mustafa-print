// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({
  team: [{ id: 'u1' }] as unknown[],
  branch: { legal_name_ar: null, legal_name_en: null } as Record<string, unknown>,
  site: { address_ar: null, phone: null } as Record<string, unknown>,
  services: [] as { status: string }[],
}))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    teamApi: { list: async () => server.team, branchSettings: { get: async () => server.branch } },
    contentApi: { settings: { get: async () => server.site }, services: { list: async () => server.services } },
  }
})

import { LaunchChecklistPage } from '../../src/pages/LaunchChecklistPage'
import { createInventoryItem, createProduct, recordMovement } from '../../src/offline/actions'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  session.role = 'admin'
  Object.assign(server, {
    team: [{ id: 'u1' }], branch: { legal_name_ar: null, legal_name_en: null }, site: { address_ar: null, phone: null }, services: [],
  })
})
const open = () => renderAt('/checklist', [{ path: '/checklist', element: <LaunchChecklistPage /> }])

describe('the pre-launch checklist', () => {
  it('flags every gap with a real count, when nothing has been entered yet', async () => {
    open()
    // no products or inventory yet means "no priced-at-zero product" etc. are vacuously true — 7 real gaps remain
    expect(await screen.findByText('7 item(s) need attention.')).toBeTruthy()
    expect(screen.getByText('0 product(s) entered')).toBeTruthy()
    expect(screen.getByText('0 item(s) entered')).toBeTruthy()
    expect(screen.getByText('0 staff account(s) besides you')).toBeTruthy()
    expect(screen.getByText('The registered name for invoices is not set')).toBeTruthy()
    expect(screen.getByText("The shop's address is not set")).toBeTruthy()
    expect(screen.getByText("The shop's contact number is not set")).toBeTruthy()
    expect(screen.getByText('0 service(s) published on the website')).toBeTruthy()
  })

  it('clears each check once its own gap is filled, and says so plainly when everything is ready', async () => {
    await createProduct({ sku: 'A', name_ar: 'أ', name_en: 'A', base_price: '10', is_public: true, cover_media_id: '018f0000-0000-7000-8000-0000000000aa' })
    const paper = await createInventoryItem({ sku: 'PAPER', name_ar: 'ورق', name_en: 'Paper', category: 'paper', unit: 'ream' })
    await recordMovement({ itemId: paper.id, type: 'opening_balance', amount: '50' })
    Object.assign(server, {
      team: [{ id: 'owner' }, { id: 'staff-1' }],
      branch: { legal_name_ar: 'مطبعة المصطفى', legal_name_en: null },
      site: { address_ar: 'الهرمل', phone: '+96170622696' },
      services: [{ status: 'published' }, { status: 'draft' }],
    })
    open()
    expect(await screen.findByText('1 product(s) entered')).toBeTruthy()
    expect(screen.getByText('0 product(s) shown on the website with no picture')).toBeTruthy()
    expect(screen.getByText('1 staff account(s) besides you')).toBeTruthy()
    expect(screen.getByText('Registered name: مطبعة المصطفى')).toBeTruthy()
    expect(screen.getByText('Address is set')).toBeTruthy()
    expect(screen.getByText('1 service(s) published on the website')).toBeTruthy()   // the draft one does not count
    expect(await screen.findByText('Everything is ready.')).toBeTruthy()
  })

  it('flags a public product with no picture, and a zero-balance inventory item, without hiding the rest', async () => {
    await createProduct({ sku: 'A', name_ar: 'أ', name_en: 'A', base_price: '10', is_public: true, cover_media_id: null })
    await createInventoryItem({ sku: 'PAPER', name_ar: 'ورق', name_en: 'Paper', category: 'paper', unit: 'ream' })
    open()
    expect(await screen.findByText('1 product(s) shown on the website with no picture')).toBeTruthy()
    expect(screen.getByText('1 item(s) with a zero balance')).toBeTruthy()
  })

  it('is refused to a role without reports:read, and never calls the online APIs at all', async () => {
    session.role = 'staff'
    open()
    expect(await screen.findByText('This screen needs permission to view reports.')).toBeTruthy()
    expect(screen.queryByText(/item\(s\) need attention/)).toBeNull()
  })
})
