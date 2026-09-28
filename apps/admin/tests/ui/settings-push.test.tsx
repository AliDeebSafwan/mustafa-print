// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'staff', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({ publicKey: 'test-public-key' as string | null, subscribed: [] as unknown[][], unsubscribed: [] as string[] }))
vi.mock('../../src/offline/request-sync', () => ({ requestSync: vi.fn() }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  return {
    ...actual,
    pushApi: {
      vapidPublicKey: async () => ({ publicKey: server.publicKey }),
      subscribe: async (...args: unknown[]) => { server.subscribed.push(args) },
      unsubscribe: async (endpoint: string) => { server.unsubscribed.push(endpoint) },
    },
  }
})

import { SettingsPage } from '../../src/pages/SettingsPage'
import { renderAt, resetApp } from './harness'

/** A fake service-worker registration whose pushManager remembers whether "the browser" has a subscription. */
function mockServiceWorker(initiallySubscribed: boolean) {
  let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = initiallySubscribed
    ? { endpoint: 'https://push.example/existing', toJSON: () => ({ endpoint: 'https://push.example/existing', keys: {} }), unsubscribe: async () => { subscription = null; return true } }
    : null
  const registration = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async () => {
        subscription = { endpoint: 'https://push.example/new', toJSON: () => ({ endpoint: 'https://push.example/new', keys: {} }), unsubscribe: async () => { subscription = null; return true } }
        return subscription
      },
    },
  }
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration) } })
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} })
}

function mockNotifications(permission: NotificationPermission, requestResolvesTo: NotificationPermission = permission) {
  const requestPermission = vi.fn().mockResolvedValue(requestResolvesTo)
  Object.defineProperty(window, 'Notification', { configurable: true, value: { permission, requestPermission } })
  return requestPermission
}

beforeEach(async () => {
  await resetApp('en')
  session.role = 'staff'
  Object.assign(server, { publicKey: 'test-public-key', subscribed: [], unsubscribed: [] })
})
const open = () => renderAt('/', [{ path: '/', element: <SettingsPage /> }])
const pushRow = () => within(screen.getByText('New web order alert').closest('div')!)

describe('the new-web-order push alert', () => {
  it('is hidden entirely on a browser that does not support it', async () => {
    // jsdom itself provides neither serviceWorker nor PushManager by default
    open()
    expect(await screen.findByText('This browser does not support this kind of notification.')).toBeTruthy()
    expect(within(screen.getByText('New web order alert').closest('div')!).queryByRole('button')).toBeNull()
  })

  it('subscribes this device after the permission prompt is granted', async () => {
    mockServiceWorker(false)
    mockNotifications('default', 'granted')
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('Off')).toBeTruthy()
    await user.click(pushRow().getByRole('button', { name: 'Request' }))
    expect(await screen.findByText('Enabled on this device')).toBeTruthy()
    expect(server.subscribed).toEqual([[{ endpoint: 'https://push.example/new', keys: {} }]])
  })

  it('explains a declined permission prompt without crashing, and stays off', async () => {
    mockServiceWorker(false)
    const requestPermission = mockNotifications('default')
    requestPermission.mockResolvedValueOnce('denied')
    const user = userEvent.setup()
    open()
    await screen.findByText('Off')
    await user.click(pushRow().getByRole('button', { name: 'Request' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Off')).toBeTruthy()
    expect(server.subscribed).toHaveLength(0)
  })

  it('shows already-subscribed state, and turning it off unsubscribes on both sides', async () => {
    mockServiceWorker(true)
    mockNotifications('granted')
    const user = userEvent.setup()
    open()
    expect(await screen.findByText('Enabled on this device')).toBeTruthy()
    await user.click(pushRow().getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText('Off')).toBeTruthy()
    expect(server.unsubscribed).toEqual(['https://push.example/existing'])
  })

  it('says plainly when the server has not enabled this feature yet', async () => {
    server.publicKey = null
    mockServiceWorker(false)
    mockNotifications('default')
    const user = userEvent.setup()
    open()
    await screen.findByText('Off')
    await user.click(pushRow().getByRole('button', { name: 'Request' }))
    expect(await screen.findByText('This alert has not been enabled on the server yet.')).toBeTruthy()
  })
})
