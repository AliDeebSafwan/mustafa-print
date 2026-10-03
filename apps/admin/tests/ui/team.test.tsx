// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ role: 'admin', id: '018f0000-0000-7000-8000-00000000c001', maxDiscountPercent: null as number | null }))
const server = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
  branch: { id: 'b1', max_discount_percent: null as string | null, row_version: 1, legal_name_ar: null as string | null, legal_name_en: null as string | null, tax_number: null as string | null, vat_enabled: false, vat_rate_percent: '0', invoice_footer_ar: null as string | null, invoice_footer_en: null as string | null, deposit_percent: '0', deposit_threshold: null as string | null, summary_email: null as string | null, summary_hour: 21 },
  created: [] as unknown[][], saved: [] as unknown[][], resetCalls: [] as unknown[][], endCalls: [] as unknown[][],
  failNext: null as null | { code: string; detail?: string },
}))
vi.mock('../../src/auth', async () => (await import('./harness')).authMock(session))
vi.mock('../../src/content', async () => {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content')
  const fail = () => { if (server.failNext) { const f = server.failNext; server.failNext = null; throw new actual.ContentError(f.code as never, f.detail) } }
  return {
    ...actual,
    teamApi: {
      list: async () => server.users,
      create: async (...args: unknown[]) => { fail(); server.created.push(args); return { id: 'new-user', row_version: 1, ...(args[0] as object) } },
      save: async (...args: unknown[]) => { fail(); server.saved.push(args); return { ...(args[0] as object), ...(args[1] as object) } },
      resetPassword: async (...args: unknown[]) => { fail(); server.resetCalls.push(args) },
      endSessions: async (...args: unknown[]) => { fail(); server.endCalls.push(args) },
      auditLog: async () => server.audit,
      branchSettings: {
        get: async () => server.branch,
        save: async (...args: unknown[]) => { fail(); server.branch = { ...server.branch, ...(args[1] as object) }; return server.branch },
      },
    },
  }
})

import { AuditLogScreen } from '../../src/pages/team/AuditLogScreen'
import { ShopSettingsScreen } from '../../src/pages/team/ShopSettingsScreen'
import { StaffScreen } from '../../src/pages/team/StaffScreen'
import { renderAt, resetApp } from './harness'

beforeEach(async () => {
  await resetApp('en')
  session.role = 'admin'
  Object.assign(server, {
    users: [{ id: 'u1', row_version: 2, full_name: 'Rana Khalil', email: 'rana@example.com', phone_e164: null, locale: 'en', is_active: true, role_key: 'staff', granted_permissions: [], permissions: ['orders:create'], last_login_at: null, created_at: '2026-01-01' }],
    audit: [], branch: { id: 'b1', max_discount_percent: null, row_version: 1, legal_name_ar: null, legal_name_en: null, tax_number: null, vat_enabled: false, vat_rate_percent: '0', invoice_footer_ar: null, invoice_footer_en: null, deposit_percent: '0', deposit_threshold: null, summary_email: null, summary_hour: 21 }, created: [], saved: [], resetCalls: [], endCalls: [], failNext: null,
  })
})
const openStaff = () => renderAt('/team', [{ path: '/team', element: <StaffScreen /> }])
const openAudit = () => renderAt('/team/audit-log', [{ path: '/team/audit-log', element: <AuditLogScreen /> }])
const openSettings = () => renderAt('/team/settings', [{ path: '/team/settings', element: <ShopSettingsScreen /> }])

describe('the staff screen', () => {
  it('lists the team and shows an inactive member dimmed', async () => {
    server.users = [...server.users, { ...server.users[0], id: 'u2', full_name: 'Old Employee', is_active: false }]
    openStaff()
    expect(await screen.findByText('Rana Khalil')).toBeTruthy()
    expect(screen.getByText('Old Employee')).toBeTruthy()
    expect(screen.getByText('disabled')).toBeTruthy()
  })

  it('creates a staff member with exactly the extra permissions ticked', async () => {
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: 'Add a member' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the full name')

    await user.type(screen.getByLabelText('Full name'), 'Karim Saad')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter an email or a phone number')

    await user.type(screen.getByLabelText('Email'), 'karim@example.com')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toContain('at least 8 characters')

    await user.type(screen.getByLabelText(/^Password/), 'a good long password')
    await user.click(screen.getByLabelText('Cancel orders'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(server.created).toHaveLength(1))
    expect(server.created[0]![0]).toMatchObject({
      full_name: 'Karim Saad', email: 'karim@example.com', password: 'a good long password', role_key: 'staff', granted_permissions: ['orders:cancel'],
    })
  })

  it('accepts a phone number typed the local way and stores it in international form', async () => {
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: 'Add a member' }))
    await user.type(screen.getByLabelText('Full name'), 'Karim Saad')
    await user.type(screen.getByLabelText('Phone number'), '70 123 456')
    await user.type(screen.getByLabelText(/^Password/), 'worker-password-1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(server.created).toHaveLength(1))
    expect(server.created[0]![0]).toMatchObject({ full_name: 'Karim Saad', phone_e164: '+96170123456', email: null })
  })

  it('names the phone as the problem when it is not a number, without calling the server', async () => {
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: 'Add a member' }))
    await user.type(screen.getByLabelText('Full name'), 'Karim Saad')
    await user.type(screen.getByLabelText('Phone number'), '12')
    await user.type(screen.getByLabelText(/^Password/), 'worker-password-1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/^This phone number is not valid/)
    expect(server.created).toHaveLength(0)
  })

  it('names the field the server rejected instead of a bare "invalid details"', async () => {
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: 'Add a member' }))
    await user.type(screen.getByLabelText('Full name'), 'Karim Saad')
    await user.type(screen.getByLabelText('Email'), 'karim@example.com')
    await user.type(screen.getByLabelText(/^Password/), 'worker-password-1')
    server.failNext = { code: 'invalid_request', detail: 'email: Invalid email address' }
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This email address is not valid.')
  })

  it('an admin role hides the extra-permissions list, since it always has everything', async () => {
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: 'Add a member' }))
    expect(screen.getByText('Extra permissions')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Role'), 'admin')
    expect(screen.queryByText('Extra permissions')).toBeNull()
  })

  it('edits an existing member and explains a duplicate email in plain words', async () => {
    server.failNext = { code: 'invalid_request', detail: 'email_in_use' }
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: /Rana Khalil/ }))
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Rana Khalil')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This email is already in use.')
  })

  it('explains the last-admin protection in plain words', async () => {
    server.failNext = { code: 'invalid_request', detail: 'last_admin' }
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: /Rana Khalil/ }))
    await user.click(screen.getByLabelText('Account is active'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe("This is the shop's last admin. Add another admin first.")
  })

  it('resets a password and ends sessions from the edit screen, without touching the save form', async () => {
    const user = userEvent.setup()
    openStaff()
    await user.click(await screen.findByRole('button', { name: /Rana Khalil/ }))
    await user.click(screen.getByRole('button', { name: 'Reset password' }))
    await user.click(screen.getByRole('button', { name: 'Set password' }))
    expect((await screen.findByRole('alert')).textContent).toContain('at least 8 characters')
    await user.type(screen.getByLabelText('New password'), 'a brand new long password')
    await user.click(screen.getByRole('button', { name: 'Set password' }))
    await vi.waitFor(() => expect(server.resetCalls).toHaveLength(1))
    expect(server.resetCalls[0]).toEqual(['u1', 'a brand new long password'])
    expect(await screen.findByText('Password reset. They will need to sign in again on every device.')).toBeTruthy()
    expect(server.saved).toHaveLength(0)

    vi.spyOn(window, 'confirm').mockReturnValue(true)   // jsdom has no real confirm() dialog
    await user.click(screen.getByRole('button', { name: 'End sessions everywhere' }))
    await vi.waitFor(() => expect(server.endCalls).toHaveLength(1))
    expect(server.endCalls[0]).toEqual(['u1'])
  })
})

describe('the audit log screen', () => {
  it('describes each action in plain words and never shows a raw action key', async () => {
    server.audit = [
      { id: 'a1', action: 'user.created', target_type: 'user', target_id: 'u9', details: { role: 'staff' }, created_at: '2026-01-02T10:00:00Z', actor_name: 'Owner' },
      { id: 'a2', action: 'user.password_reset', target_type: 'user', target_id: 'u9', details: {}, created_at: '2026-01-02T09:00:00Z', actor_name: 'Owner' },
      { id: 'a3', action: 'branch_settings.updated', target_type: 'branch', target_id: 'b1', details: { max_discount_percent: 10 }, created_at: '2026-01-01T09:00:00Z', actor_name: 'Owner' },
    ]
    openAudit()
    expect(await screen.findByText('Added a new member with the Staff role')).toBeTruthy()
    expect(screen.getByText('Password reset')).toBeTruthy()
    expect(screen.getByText('Shop settings changed')).toBeTruthy()
    expect(screen.queryByText('user.created')).toBeNull()
  })

  it('shows an empty state instead of nothing', async () => {
    openAudit()
    expect(await screen.findByText('No entries yet.')).toBeTruthy()
  })
})

describe('the shop settings screen', () => {
  it('saves a discount cap and shows it took effect', async () => {
    const user = userEvent.setup()
    openSettings()
    await user.type(await screen.findByLabelText(/^Discount cap/), '12.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(server.branch.max_discount_percent).toBe(12.5))
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it('an empty field clears the cap (no limit)', async () => {
    server.branch = { id: 'b1', max_discount_percent: '10', row_version: 1, legal_name_ar: null, legal_name_en: null, tax_number: null, vat_enabled: false, vat_rate_percent: '0', invoice_footer_ar: null, invoice_footer_en: null, deposit_percent: '0', deposit_threshold: null, summary_email: null, summary_hour: 21 }
    const user = userEvent.setup()
    openSettings()
    const field = (await screen.findByLabelText(/^Discount cap/)) as HTMLInputElement
    expect(field.value).toBe('10')
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(server.branch.max_discount_percent).toBeNull())
  })

  it('saves the deposit percent and threshold together', async () => {
    const user = userEvent.setup()
    openSettings()
    await user.type(await screen.findByLabelText('Deposit percent'), '40')
    await user.type(await screen.findByLabelText(/^Only required for orders/), '100')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(server.branch.deposit_percent).toBe(40))
    expect(server.branch.deposit_threshold).toBe(100)
  })

  it('saves the owner\'s daily summary address and hour, and clears it by emptying the address', async () => {
    const user = userEvent.setup()
    openSettings()
    expect(screen.queryByLabelText('Send at (shop\'s local time)')).toBeNull()          // no address yet: nothing to schedule
    await user.type(await screen.findByLabelText('Your email for the summary'), 'owner@example.com')
    await user.selectOptions(await screen.findByLabelText('Send at (shop\'s local time)'), '20')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(server.branch.summary_email).toBe('owner@example.com'))
    expect(server.branch.summary_hour).toBe(20)

    await user.clear(await screen.findByLabelText('Your email for the summary'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(server.branch.summary_email).toBeNull())
  })

  it('only shows the threshold field once a deposit percent is set', async () => {
    const user = userEvent.setup()
    openSettings()
    await screen.findByLabelText('Deposit percent')                              // the percent field is always there
    expect(screen.queryByLabelText(/Only required for orders/)).toBeNull()       // but the threshold has nothing to qualify yet

    await user.type(screen.getByLabelText('Deposit percent'), '30')
    expect(await screen.findByLabelText(/Only required for orders/)).toBeTruthy()
  })
})
