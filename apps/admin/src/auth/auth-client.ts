import { sessionResponseSchema, type SessionBranch, type SessionResponse, type SessionUser } from '@mpe/shared'
import { db, getMeta, setMeta, wipeLocalData } from '../offline/db'

/**
 * Staff session, built for a shop where the internet comes and goes:
 *  - The access token lives ONLY in memory (15 minutes). The refresh token is an httpOnly cookie this code never sees.
 *  - Who is signed in is remembered on the device, so the app keeps working offline after a restart.
 *  - Losing the connection never signs anyone out; only the server saying "this session is over" does.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; user: SessionUser; branch: SessionBranch | null }

export class InvalidCredentialsError extends Error {
  constructor() { super('Invalid credentials'); this.name = 'InvalidCredentialsError' }
}
export class TooManyAttemptsError extends Error {
  readonly retryAfterSeconds: number
  constructor(retryAfterSeconds: number) { super('Too many attempts'); this.name = 'TooManyAttemptsError'; this.retryAfterSeconds = retryAfterSeconds }
}
export class NetworkError extends Error {
  constructor() { super('Network unavailable'); this.name = 'NetworkError' }
}
export class ServerError extends Error {
  constructor() { super('Server error'); this.name = 'ServerError' }
}
/** Unsent changes exist and would be lost or mixed up with another user's work. */
export class PendingChangesError extends Error {
  readonly pending: number
  constructor(pending: number) { super(`${pending} unsent changes`); this.name = 'PendingChangesError'; this.pending = pending }
}

const USER_KEY = 'session.user'
const BRANCH_KEY = 'session.branch'
const EXPIRY_SKEW_MS = 30_000
const RACE_RETRY_MS = 250

export interface AuthClientOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  now?: () => number
}

export type AuthClient = ReturnType<typeof createAuthClient>

export function createAuthClient({ baseUrl, fetchImpl, now = Date.now }: AuthClientOptions) {
  const call = (path: string, init: RequestInit = {}) =>
    (fetchImpl ?? fetch)(`${baseUrl}/api/v1/auth${path}`, { method: 'POST', credentials: 'include', ...init })

  let state: AuthState = { status: 'loading' }
  let token: { value: string; expiresAt: number } | null = null
  let inflight: Promise<string | null> | null = null
  const listeners = new Set<() => void>()

  const setState = (next: AuthState) => { state = next; listeners.forEach((listener) => listener()) }
  const parseSession = async (res: Response): Promise<SessionResponse | null> => {
    const parsed = sessionResponseSchema.safeParse(await res.json().catch(() => null))
    return parsed.success ? parsed.data : null
  }

  async function adopt(session: SessionResponse): Promise<void> {
    token = { value: session.accessToken, expiresAt: now() + session.expiresIn * 1000 }
    await setMeta(USER_KEY, session.user)                                        // remembered for offline restarts
    await setMeta(BRANCH_KEY, session.branch)                                    // the shop's rules travel with it
    setState({ status: 'signed_in', user: session.user, branch: session.branch }) // permissions may have changed since last time
  }

  /**
   * Changes the signed-in person's own password. The server signs out every OTHER device but reissues a fresh
   * session for this one, so `adopt` here is what keeps the current device working without a fresh login.
   */
  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const accessToken = token && token.expiresAt - EXPIRY_SKEW_MS > now() ? token.value : await refresh()
    if (!accessToken) throw new ServerError()
    let res: Response
    try {
      res = await call('/change-password', {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
    } catch { throw new NetworkError() }
    if (res.status === 401) throw new InvalidCredentialsError()
    const session = res.ok ? await parseSession(res) : null
    if (!session) throw new ServerError()
    await adopt(session)
  }

  /** The server ended this session (expired, revoked, user disabled). Unsent work is KEPT so the same user can resume it. */
  function sessionEnded(): void {
    token = null
    setState({ status: 'signed_out' })
  }

  async function refreshOnce(): Promise<Response | null> {
    try { return await call('/refresh') } catch { return null }
  }

  async function doRefresh(): Promise<string | null> {
    let res = await refreshOnce()
    if (res?.status === 401 && (await res.clone().json().catch(() => null))?.error === 'refresh_race') {
      // Another tab rotated the token a moment ago; the browser cookie is already the new one.
      await new Promise((resolve) => setTimeout(resolve, RACE_RETRY_MS))
      res = await refreshOnce()
    }
    if (!res) return null                                       // offline: carry on with local data, try again later
    if (res.status === 401) { sessionEnded(); return null }
    if (!res.ok) return null
    const session = await parseSession(res)
    if (!session) return null
    await adopt(session)
    return session.accessToken
  }

  /** One refresh at a time, however many callers ask (sync timer, focus event, several tabs' requests). */
  const refresh = (): Promise<string | null> => (inflight ??= doRefresh().finally(() => { inflight = null }))

  return {
    getState: (): AuthState => state,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) },

    /** Call once at startup. Shows the app immediately when a user is remembered, then gets a token in the background. */
    async start(): Promise<void> {
      const [user, branch] = await Promise.all([getMeta<SessionUser>(USER_KEY), getMeta<SessionBranch>(BRANCH_KEY)])
      if (!user) { setState({ status: 'signed_out' }); return }
      setState({ status: 'signed_in', user, branch: branch ?? null })
      void refresh()
    },

    /** A valid access token, refreshing it when it is about to expire; null when signed out or offline. */
    async getAccessToken(): Promise<string | null> {
      if (state.status !== 'signed_in') return null
      if (token && token.expiresAt - EXPIRY_SKEW_MS > now()) return token.value
      return refresh()
    },

    async login(identifier: string, password: string): Promise<SessionUser> {
      let res: Response
      try {
        res = await call('/login', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }) })
      } catch { throw new NetworkError() }
      if (res.status === 429) throw new TooManyAttemptsError(Number(res.headers.get('Retry-After')) || 900)
      if (res.status === 401 || res.status === 400) throw new InvalidCredentialsError()
      const session = res.ok ? await parseSession(res) : null
      if (!session) throw new ServerError()

      // A different person on the same device must never see, or inherit, the previous user's data or unsent work.
      const previous = await getMeta<SessionUser>(USER_KEY)
      if (previous && previous.id !== session.user.id) {
        const pending = await db.outbox.count()
        if (pending > 0) {
          await call('/logout').catch(() => undefined)          // do not leave a live session behind
          throw new PendingChangesError(pending)
        }
        await wipeLocalData()
      }
      await adopt(session)
      return session.user
    },

    /** Wraps the module-level changePassword so it is reachable on the public client. */
    changePassword,

    /**
     * Signs out and wipes this device's copy of the data. Refuses while unsent changes exist unless told to discard them.
     * If the network is down the server session simply ends with its cookie's expiry.
     */
    async logout(opts: { discardUnsent?: boolean } = {}): Promise<void> {
      const pending = await db.outbox.count()
      if (pending > 0 && !opts.discardUnsent) throw new PendingChangesError(pending)
      await call('/logout').catch(() => undefined)
      token = null
      await wipeLocalData()
      setState({ status: 'signed_out' })
    },
  }
}
