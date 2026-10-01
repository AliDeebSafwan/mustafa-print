import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LOCALES, PASSWORD_MIN, roleDefinition } from '@mpe/shared'
import { auth, useAuth, useCan } from '../auth'
import { InvalidCredentialsError, PendingChangesError } from '../auth/auth-client'
import { getDeviceId, requestPersistentStorage } from '../lib/device'
import { THEMES, setTheme, useTheme } from '../lib/theme'
import { inputCls, labelCls, primaryBtn } from '../lib/ui'
import { db, getMeta } from '../offline/db'
import { disablePush, enablePush, pushStatus, type PushSupport } from '../offline/push'
import type { SyncResult } from '../offline/sync'

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const conflicts = useLiveQuery(() => db.conflicts.where('resolved').equals(0).count(), [], 0)
  const last = useLiveQuery(() => getMeta<SyncResult>('lastSync'), [])
  const state = useAuth()
  const can = useCan()
  const theme = useTheme()
  const [unsent, setUnsent] = useState<number | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => { void navigator.storage?.persisted?.().then(setPersisted) }, [])

  const signOut = async (discardUnsent = false) => {
    try { await auth.logout({ discardUnsent }) } catch (err) { if (err instanceof PendingChangesError) setUnsent(err.pending); else throw err }
  }
  const user = state.status === 'signed_in' ? state.user : null
  const roleName = user ? roleDefinition(user.role) : undefined

  const row = 'flex items-center justify-between gap-4 py-3'
  return (
    <section className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-extrabold">{t('settings.title')}</h1>
      {can('notifications:templates:read') && (
        <Link to="/messages" className="mt-4 block border border-ink px-4 py-3 font-semibold">{t('messages.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      )}
      {can('users:manage') && (
        <Link to="/team" className="mt-2 block border border-ink px-4 py-3 font-semibold">{t('team.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      )}
      {can('reports:read') && (
        <Link to="/reports" className="mt-2 block border border-ink px-4 py-3 font-semibold">{t('reports.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      )}
      {can('reports:read') && (
        <Link to="/checklist" className="mt-2 block border border-ink px-4 py-3 font-semibold">{t('checklist.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      )}
      {can('transactions:read') && (
        <Link to="/reconcile" className="mt-2 block border border-ink px-4 py-3 font-semibold">{t('reconcile.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      )}
      {can('customer_accounts:manage') && (
        <Link to="/customer-accounts" className="mt-2 block border border-ink px-4 py-3 font-semibold">{t('accounts.title')} <span className="arrow-go" aria-hidden="true">←</span></Link>
      )}
      <dl className="mt-4 divide-y divide-rule border-y border-rule">
        {user && (
          <div className={row}>
            <dt>{t('settings.account')}</dt>
            <dd className="text-end"><span className="font-bold">{user.fullName}</span><br /><span className="text-sm text-muted">{i18n.language === 'ar' ? roleName?.name_ar : roleName?.name_en}</span></dd>
          </div>
        )}
        <div className={row}>
          <dt>{t('settings.language')}</dt>
          <dd className="flex gap-2">
            {LOCALES.map((l) => (
              <button key={l} onClick={() => void i18n.changeLanguage(l)} aria-pressed={i18n.language === l}
                className={`border border-ink px-3 py-1 font-semibold ${i18n.language === l ? 'bg-ink text-white' : ''}`}>{l === 'ar' ? 'العربية' : 'English'}</button>
            ))}
          </dd>
        </div>
        <div className={row}>
          <dt>{t('settings.appearance')}</dt>
          <dd className="flex gap-2">
            {THEMES.map((th) => (
              <button key={th} type="button" onClick={() => setTheme(th)} aria-pressed={theme === th}
                className={`border border-ink px-3 py-1 font-semibold ${theme === th ? 'bg-ink text-white' : ''}`}>{th === 'classic' ? t('settings.themeClassic') : t('settings.theme2100')}</button>
            ))}
          </dd>
        </div>
        <div className={row}><dt>{t('settings.pending')}</dt><dd className="font-bold">{pending}</dd></div>
        <div className={row}>
          <dt>{t('settings.conflicts')}</dt>
          <dd className="font-bold">{conflicts > 0 ? <Link to="/review" className="text-magenta underline">{t('settings.reviewNow', { count: conflicts })}</Link> : conflicts}</dd>
        </div>
        <div className={row}>
          <dt>{t('settings.lastSync')}</dt>
          <dd className="text-end text-sm">
            {last ? <>{new Date(last.at).toLocaleString(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en')}<br /><span className="text-muted">{t(`settings.syncResult.${last.pull.status === 'ok' ? last.push.status === 'idle' ? 'ok' : last.push.status : last.pull.status}`)}</span></> : t('settings.never')}
          </dd>
        </div>
        <div className={row}>
          <dt>{t('settings.storage')}</dt>
          <dd className="flex items-center gap-2 text-sm">
            {persisted ? t('settings.storageOn') : t('settings.storageOff')}
            {!persisted && <button className="border border-ink px-2 py-1 font-semibold" onClick={() => void requestPersistentStorage().then(setPersisted)}>{t('settings.enable')}</button>}
          </dd>
        </div>
        {can('orders:read') && <PushNotificationRow />}
        <div className={row}><dt>{t('settings.device')}</dt><dd className="font-mono text-xs" dir="ltr">{getDeviceId().slice(0, 8)}</dd></div>
      </dl>
      <MyPasswordSection />
      {unsent !== null ? (
        <div role="alert" className="mt-4 border-s-4 border-magenta bg-tint p-3">
          <p className="font-semibold">{t('settings.signOutPending', { count: unsent })}</p>
          <div className="mt-3 flex gap-2">
            <button className="bg-ink px-3 py-2 font-semibold text-white" onClick={() => void signOut(true)}>{t('settings.signOutAnyway')}</button>
            <button className="border border-ink px-3 py-2 font-semibold" onClick={() => setUnsent(null)}>{t('settings.cancel')}</button>
          </div>
        </div>
      ) : (
        <button className="mt-4 border border-ink px-4 py-2 font-semibold" onClick={() => void signOut()}>{t('settings.signOut')}</button>
      )}
    </section>
  )
}

/** Anyone signed in may change their own password: it proves who they are, no separate permission needed. */
function MyPasswordSection() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setMessage(null)
    if (next.trim().length < PASSWORD_MIN) return setMessage({ kind: 'error', text: t('team.passwordTooShort', { n: PASSWORD_MIN }) })
    setBusy(true)
    try {
      await auth.changePassword(current, next)
      setCurrent('')
      setNext('')
      setOpen(false)
      setMessage({ kind: 'ok', text: t('settings.passwordChanged') })
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof InvalidCredentialsError ? t('settings.wrongCurrentPassword') : t('common.error') })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-4">
        <button type="button" className="border border-ink px-4 py-2 font-semibold" onClick={() => setOpen(true)}>{t('settings.changePassword')}</button>
        {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm font-semibold ${message.kind === 'error' ? 'text-magenta' : 'text-ok'}`}>{message.text}</p>}
      </div>
    )
  }
  return (
    <div className="mt-4 flex flex-col gap-3 border border-ink p-3">
      <label className={labelCls}>{t('settings.currentPassword')}
        <input className={inputCls} dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className={labelCls}>{t('settings.newPassword')}
        <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      {message && <p role="alert" className="text-sm font-semibold text-magenta">{message.text}</p>}
      <div className="flex gap-2">
        <button type="button" className={`${primaryBtn} flex-1`} disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
        <button type="button" className="border border-ink px-4 py-3 font-semibold" onClick={() => { setOpen(false); setCurrent(''); setNext(''); setMessage(null) }}>{t('common.cancel')}</button>
      </div>
    </div>
  )
}

/** A new web order, even with the app closed — the alternative to a WhatsApp alert that needs no Meta approval.
 *  Each browser subscribes for itself; there is no "turn it on for the whole shop" setting. */
function PushNotificationRow() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<PushSupport | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void pushStatus().then(setStatus) }, [])

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      if (status === 'subscribed') {
        await disablePush()
        setStatus('not-subscribed')
      } else {
        await enablePush()
        setStatus('subscribed')
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setError(code === 'push_not_configured' ? t('settings.push.notConfigured') : code === 'permission_denied' ? t('settings.push.permissionDenied') : t('common.error'))
      setStatus(await pushStatus())
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return null
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt>{t('settings.push.title')}</dt>
      <dd className="flex items-center gap-2 text-sm">
        {status === 'unsupported' ? (
          <span className="text-muted">{t('settings.push.unsupported')}</span>
        ) : status === 'denied' ? (
          <span className="text-muted">{t('settings.push.denied')}</span>
        ) : (
          <>
            {status === 'subscribed' ? t('settings.push.on') : t('settings.push.off')}
            <button type="button" className="border border-ink px-2 py-1 font-semibold disabled:opacity-50" disabled={busy} onClick={() => void toggle()}>
              {status === 'subscribed' ? t('settings.push.turnOff') : t('settings.enable')}
            </button>
          </>
        )}
      </dd>
      {error && <p role="alert" className="col-span-2 -mt-1 text-xs font-semibold text-magenta">{error}</p>}
    </div>
  )
}
