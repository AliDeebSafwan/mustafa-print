// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({ saved: [] as unknown[][] }))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content/templates-api', () => ({
  templatesApi: {
    list: async () => [
      { id: 't1', row_version: 3, template_key: 'order.ready', channel: 'sms', locale: 'en', subject: null, body: 'Order {{order_id}} is ready', variables: ['order_id'], provider_template_name: null, is_active: true },
      { id: 't2', row_version: 1, template_key: 'order.received', channel: 'whatsapp', locale: 'en', subject: null, body: 'Hi {{customer_name}}, order {{order_id}}', variables: ['customer_name', 'order_id'], provider_template_name: 'order_received_v1', is_active: true },
    ],
    save: async (...args: unknown[]) => { server.saved.push(args); return {} },
  },
}))

import { MessagesPage } from '../../src/pages/MessagesPage'
import { renderAt, resetApp } from './harness'

beforeEach(async () => { await resetApp('en'); server.saved = [] })
const open = () => renderAt('/messages', [{ path: '/messages', element: <MessagesPage /> }])

describe('customer messages', () => {
  it('previews the message with an example as the owner types, and saves it', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Order ready/ }))
    expect(screen.getByText('Order 1042 is ready')).toBeTruthy()
    await user.clear(screen.getByLabelText('Message text'))
    await user.type(screen.getByLabelText('Message text'), 'Rana? Order {{{{order_id}} is ready to collect')
    expect(await screen.findByText('Rana? Order 1042 is ready to collect')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(server.saved).toHaveLength(1))
    expect(server.saved[0]).toEqual([expect.objectContaining({ id: 't1', row_version: 3 }), expect.objectContaining({ body: 'Rana? Order {{order_id}} is ready to collect', is_active: true })])
  })

  it('catches a misspelled detail before saving', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Order ready/ }))
    await user.type(screen.getByLabelText('Message text'), ' {{{{ordr_id}}')
    expect((await screen.findByRole('alert')).textContent).toContain('{{ordr_id}}')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains the WhatsApp rule and lets a new approval through', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: /Order received/ }))
    expect(screen.getByText(/arrive with the wording Meta approved/)).toBeTruthy()
    await user.clear(screen.getByLabelText('Message text'))
    await user.type(screen.getByLabelText('Message text'), 'Order {{{{order_id}} for {{{{customer_name}}')
    expect((await screen.findByRole('alert')).textContent).toContain('keep the details in the same order')
    await user.clear(screen.getByLabelText(/Name of the template Meta approved/))
    await user.type(screen.getByLabelText(/Name of the template Meta approved/), 'order_received_v2')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
