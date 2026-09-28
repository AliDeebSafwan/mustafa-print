import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth'
import { InvalidCredentialsError, NetworkError, PendingChangesError, TooManyAttemptsError } from '../auth/auth-client'
import { ColorBar } from '../components/ColorBar'

export function LoginPage() {
  const { t } = useTranslation()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const describe = (err: unknown): string => {
    if (err instanceof InvalidCredentialsError) return t('login.invalid')
    if (err instanceof TooManyAttemptsError) return t('login.tooMany', { minutes: Math.max(1, Math.ceil(err.retryAfterSeconds / 60)) })
    if (err instanceof NetworkError) return t('login.network')
    if (err instanceof PendingChangesError) return t('login.otherUserPending', { count: err.pending })
    return t('login.server')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try { await auth.login(identifier.trim(), password) } catch (err) { setError(describe(err)) } finally { setBusy(false) }
  }

  const field = 'w-full border border-ink px-3 py-2.5 text-base'
  return (
    <div className="flex h-full flex-col">
      <ColorBar />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
        <h1 className="text-3xl font-extrabold">{t('brand')}</h1>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 font-semibold">
            {t('login.identifier')}
            <input className={field} dir="ltr" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required
              value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 font-semibold">
            {t('login.password')}
            <input className={field} dir="ltr" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p role="alert" className="border-s-4 border-magenta bg-tint px-3 py-2 text-sm font-semibold">{error}</p>}
          <button type="submit" disabled={busy} className="bg-ink px-4 py-3 font-bold text-white disabled:opacity-50">
            {busy ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
        <p className="text-sm text-muted">{t('login.hint')}</p>
      </main>
    </div>
  )
}
