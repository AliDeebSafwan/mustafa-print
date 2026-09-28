import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ASSIGNABLE_ROLES, PASSWORD_MIN, TOGGLEABLE_PERMISSIONS, type AssignableRole, type ToggleablePermission } from '@mpe/shared'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { ContentError, teamApi, type StaffRow } from '../../content'
import { useResource } from '../../content/use-resource'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../lib/ui'

const asContentError = (err: unknown) => (err instanceof ContentError ? err : new ContentError('server'))

/** The team: who has access, their role, and (for staff) exactly which extra permissions the owner delegated. */
export function StaffScreen() {
  const { t } = useTranslation()
  const load = useCallback(() => teamApi.list(), [])
  const { data, error, reload } = useResource(load)
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null)

  if (editing) return <StaffForm user={editing === 'new' ? null : editing} onDone={async () => { setEditing(null); await reload() }} />

  return (
    <div>
      <button type="button" className={`${primaryBtn} w-full`} onClick={() => setEditing('new')}>{t('team.new')}</button>
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      {data && data.length === 0 && <p className="mt-4 text-muted">{t('team.empty')}</p>}
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {data?.map((user) => (
          <li key={user.id}>
            <button type="button" className={`flex w-full items-center justify-between gap-3 py-3 text-start ${user.is_active ? '' : 'opacity-60'}`} onClick={() => setEditing(user)}>
              <div className="min-w-0">
                <p className="font-bold">{user.full_name}</p>
                <p className="text-xs text-muted" dir="ltr">{user.email ?? user.phone_e164}</p>
                {!user.is_active && <span className="text-xs font-bold text-magenta">{t('team.inactive')}</span>}
              </div>
              <span className={`shrink-0 px-2 py-1 text-xs font-bold ${user.role_key === 'admin' ? 'bg-ink text-white' : 'border border-ink'}`}>
                {t(`team.role.${user.role_key}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface Form {
  full_name: string; email: string; phone_e164: string; locale: 'ar' | 'en'; role_key: AssignableRole
  granted_permissions: ToggleablePermission[]; is_active: boolean; password: string
}
const formFrom = (user: StaffRow | null): Form => ({
  full_name: user?.full_name ?? '', email: user?.email ?? '', phone_e164: user?.phone_e164 ?? '', locale: user?.locale ?? 'ar',
  role_key: (user?.role_key as AssignableRole) ?? 'staff', granted_permissions: (user?.granted_permissions as ToggleablePermission[]) ?? [],
  is_active: user?.is_active ?? true, password: '',
})

function StaffForm({ user, onDone }: { user: StaffRow | null; onDone: () => Promise<void> }) {
  const { t } = useTranslation()
  const [form, setForm] = useState<Form>(formFrom(user))
  const [problem, setProblem] = useState<string | null>(null)
  const [error, setError] = useState<ContentError | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Form>(field: K, value: Form[K]) => setForm((f) => ({ ...f, [field]: value }))
  const togglePermission = (p: ToggleablePermission) =>
    setForm((f) => ({ ...f, granted_permissions: f.granted_permissions.includes(p) ? f.granted_permissions.filter((x) => x !== p) : [...f.granted_permissions, p] }))

  const detailMessage = (detail?: string) =>
    detail === 'last_admin' ? t('team.error.lastAdmin')
    : detail === 'email_in_use' ? t('team.error.emailInUse')
    : detail === 'phone_in_use' ? t('team.error.phoneInUse')
    : undefined

  async function save() {
    setProblem(null)
    setError(null)
    if (!form.full_name.trim()) return setProblem(t('team.needName'))
    if (!form.email.trim() && !form.phone_e164.trim()) return setProblem(t('team.needContact'))
    if (!user && form.password.trim().length < PASSWORD_MIN) return setProblem(t('team.passwordTooShort', { n: PASSWORD_MIN }))
    setBusy(true)
    try {
      const shared = {
        full_name: form.full_name.trim(), email: form.email.trim() || null, phone_e164: form.phone_e164.trim() || null,
        locale: form.locale, role_key: form.role_key, granted_permissions: form.role_key === 'staff' ? form.granted_permissions : [],
      }
      if (user) await teamApi.save(user, { ...shared, is_active: form.is_active })
      else await teamApi.create({ ...shared, password: form.password })
      await onDone()
    } catch (err) {
      const e = asContentError(err)
      const known = detailMessage(e.detail)
      if (known) setProblem(known)
      else setError(e)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className={labelCls}>{t('team.name')}<input className={inputCls} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} /></label>
      <label className={labelCls}>{t('customer.email')}<input className={inputCls} dir="ltr" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
      <label className={labelCls}>{t('customer.phone')}<input className={inputCls} dir="ltr" inputMode="tel" value={form.phone_e164} onChange={(e) => set('phone_e164', e.target.value)} /></label>
      {!user && (
        <label className={labelCls}>{t('team.password')}
          <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
          <span className="text-xs font-normal text-muted">{t('team.passwordHelp', { n: PASSWORD_MIN })}</span>
        </label>
      )}
      <label className={labelCls}>{t('team.roleLabel')}
        <select className={inputCls} value={form.role_key} onChange={(e) => set('role_key', e.target.value as AssignableRole)}>
          {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{t(`team.role.${r}`)}</option>)}
        </select>
      </label>

      {form.role_key === 'staff' && (
        <fieldset className="flex flex-col gap-2 border border-rule p-3">
          <legend className="px-1 text-sm font-semibold">{t('team.extraPermissions')}</legend>
          {TOGGLEABLE_PERMISSIONS.map((p) => (
            <label key={p} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-5" checked={form.granted_permissions.includes(p)} onChange={() => togglePermission(p)} />
              {t(`team.permission.${p}`)}
            </label>
          ))}
        </fieldset>
      )}

      {user && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          {t('team.active')}
        </label>
      )}

      {problem && <p role="alert" className="text-sm font-semibold text-magenta">{problem}</p>}
      <ContentErrorMessage error={error} />
      <div className="flex gap-2">
        <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
        <button type="button" className={ghostBtn} onClick={() => void onDone()}>{t('common.cancel')}</button>
      </div>

      {user && <SessionTools user={user} />}
    </div>
  )
}

/** Two actions that never touch the form's own save/version flow: setting a new password, and signing out every device. */
function SessionTools({ user }: { user: StaffRow }) {
  const { t } = useTranslation()
  const [resetting, setResetting] = useState(false)
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function resetPassword() {
    setMessage(null)
    if (password.trim().length < PASSWORD_MIN) return setMessage({ kind: 'error', text: t('team.passwordTooShort', { n: PASSWORD_MIN }) })
    setBusy(true)
    try {
      await teamApi.resetPassword(user.id, password)
      setPassword('')
      setResetting(false)
      setMessage({ kind: 'ok', text: t('team.passwordReset') })
    } catch {
      setMessage({ kind: 'error', text: t('common.error') })
    } finally {
      setBusy(false)
    }
  }

  async function endSessions() {
    if (!window.confirm(t('team.confirmEndSessions'))) return
    setBusy(true)
    try {
      await teamApi.endSessions(user.id)
      setMessage({ kind: 'ok', text: t('team.sessionsEnded') })
    } catch {
      setMessage({ kind: 'error', text: t('common.error') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-rule pt-4">
      {resetting ? (
        <div className="flex flex-col gap-2">
          <label className={labelCls}>{t('team.newPassword')}
            <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={`${ghostBtn} flex-1`} disabled={busy} onClick={() => void resetPassword()}>{t('team.setPassword')}</button>
            <button type="button" className={ghostBtn} onClick={() => { setResetting(false); setPassword('') }}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={ghostBtn} onClick={() => setResetting(true)}>{t('team.resetPassword')}</button>
      )}
      <button type="button" className={ghostBtn} disabled={busy} onClick={() => void endSessions()}>{t('team.endSessions')}</button>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm font-semibold ${message.kind === 'error' ? 'text-magenta' : 'text-ok'}`}>{message.text}</p>}
    </div>
  )
}
