// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
/** A small in-memory stand-in for the server's content API, recording what the screens send. */
const server = vi.hoisted(() => ({
  services: [] as Record<string, unknown>[], media: [] as Record<string, unknown>[], settings: {} as Record<string, unknown>,
  calls: [] as { op: string; args: unknown[] }[], failNext: null as null | { code: string; detail?: string },
}))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const { ContentError } = await import('../../src/content/api')
  const record = <T,>(op: string, result: () => T) => async (...args: unknown[]): Promise<T> => {
    server.calls.push({ op, args })
    if (server.failNext) { const f = server.failNext; server.failNext = null; throw new ContentError(f.code as never, f.detail) }
    return result()
  }
  return {
    ContentError,
    contentApi: {
      media: { list: record('media.list', () => server.media), upload: record('media.upload', () => server.media[0]), describe: record('media.describe', () => server.media[0]), remove: record('media.remove', () => undefined) },
      services: {
        list: record('services.list', () => server.services),
        create: record('services.create', () => ({ id: 's-new', row_version: 1 })),
        save: record('services.save', () => ({})),
        setStatus: record('services.setStatus', () => ({})),
        remove: record('services.remove', () => undefined),
      },
      gallery: { list: record('gallery.list', () => []), create: record('gallery.create', () => ({})), save: record('gallery.save', () => ({})), setStatus: record('gallery.setStatus', () => ({})), remove: record('gallery.remove', () => undefined) },
      settings: { get: record('settings.get', () => server.settings), save: record('settings.save', () => server.settings) },
    },
  }
})

import { SitePage } from '../../src/pages/site/SitePage'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  Object.assign(server, { services: [], media: [], calls: [], failNext: null, settings: { row_version: 3, price_display: 'from', opening_hours: [], social_links: {} } })
})
const open = (path = '/site') => renderAt(path, [{ path: '/site/*', element: <SitePage /> }])
const lastCall = (op: string) => server.calls.filter((c) => c.op === op).at(-1)

describe('the website editor', () => {
  it('suggests the page address from the English title and refuses a bad one', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'New service' }))
    await user.type(screen.getByLabelText('Title in Arabic'), 'الطباعة الرقمية')
    await user.type(screen.getByLabelText('Title in English (optional)'), 'Digital Printing & Design')
    expect((screen.getByLabelText('Page address on the website') as HTMLInputElement).value).toBe('digital-printing-design')

    await user.clear(screen.getByLabelText('Page address on the website'))
    await user.type(screen.getByLabelText('Page address on the website'), 'bad address!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The page address may only use lowercase English letters, digits and dashes')
    expect(lastCall('services.create')).toBeUndefined()

    await user.clear(screen.getByLabelText('Page address on the website'))
    await user.type(screen.getByLabelText('Page address on the website'), 'digital-printing')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(lastCall('services.create')).toBeDefined())
    expect(lastCall('services.create')!.args[0]).toMatchObject({ slug: 'digital-printing', title_ar: 'الطباعة الرقمية', title_en: 'Digital Printing & Design' })
  })

  it('explains in plain words why publishing was refused', async () => {
    server.services = [{ id: 's1', row_version: 2, slug: 'offset', title_ar: 'أوفست', status: 'draft', cover_media_id: null, is_featured: false, media_ids: [] }]
    const user = userEvent.setup()
    open()
    const toggle = await screen.findByRole('button', { name: 'Draft' })
    server.failNext = { code: 'missing_alt_text' }                 // the server refuses the publish, not the list
    await user.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toBe('Describe every picture (in Arabic at least) before publishing.')
    expect(lastCall('services.setStatus')!.args).toEqual([expect.objectContaining({ id: 's1', row_version: 2 }), 'published'])
  })

  it('tells the owner plainly when someone else saved first', async () => {
    const user = userEvent.setup()
    open('/site/details')
    await screen.findByLabelText('Tagline in Arabic')
    server.failNext = { code: 'version_conflict' }
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Someone saved a newer version meanwhile. Reopen the page and edit again.')
  })

  it('saves the shop details with phones in international form and only the filled-in social links', async () => {
    const user = userEvent.setup()
    open('/site/details')
    await user.type(await screen.findByLabelText('Tagline in Arabic'), 'نطبع أفكارك')
    await user.type(screen.getByLabelText('Phone number'), '03 123 456')
    await user.type(screen.getByLabelText('instagram'), 'https://instagram.com/shop')
    await user.selectOptions(screen.getByLabelText('Prices on the website'), 'hidden')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(lastCall('settings.save')).toBeDefined())
    const [version, data] = lastCall('settings.save')!.args as [{ row_version: number }, Record<string, unknown>]
    expect(version.row_version).toBe(3)
    expect(data).toMatchObject({ tagline_ar: 'نطبع أفكارك', phone: '+9613123456', whatsapp: null, price_display: 'hidden', social_links: { instagram: 'https://instagram.com/shop' } })
  })

  it('refuses a phone number that cannot be real before asking the server', async () => {
    const user = userEvent.setup()
    open('/site/details')
    await user.type(await screen.findByLabelText('Phone number'), '12')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('That phone number is not valid')
    expect(lastCall('settings.save')).toBeUndefined()
  })

  it('shows which pictures still need a description', async () => {
    server.media = [
      { id: 'm1', row_version: 1, alt_ar: 'آلة طباعة', alt_en: null, width: 800, height: 600, srcset: [{ width: 480, src: '/x-480.webp' }] },
      { id: 'm2', row_version: 1, alt_ar: null, alt_en: null, width: 800, height: 600, srcset: [{ width: 480, src: '/y-480.webp' }] },
    ]
    open('/site/media')
    expect(await screen.findByText('آلة طباعة')).toBeTruthy()
    expect(screen.getByText('No description')).toBeTruthy()
  })

  it('says so when there is no connection', async () => {
    server.failNext = { code: 'offline' }
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('No internet connection. Managing the website needs one.')
  })
})
