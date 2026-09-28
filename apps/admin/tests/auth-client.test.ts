import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { uuidv7, type SessionResponse } from '@mpe/shared'
import { createAuthClient, InvalidCredentialsError, NetworkError, PendingChangesError, ServerError, TooManyAttemptsError } from '../src/auth/auth-client'
import { newMutation } from '../src/offline/actions'
import { db, getMeta, setMeta } from '../src/offline/db'

const userA = { id: uuidv7(), fullName: 'Rana', role: 'receptionist' as const, branchId: uuidv7(), locale: 'ar' as const, permissions: ['orders:read'] }
const branch = {
  id: userA.branchId, nameAr: 'المصطفى', nameEn: 'Mustafa', baseCurrency: 'USD', maxDiscountPercent: 10,
  legalNameAr: null, legalNameEn: null, taxNumber: null, vatEnabled: false, vatRatePercent: 0, invoiceFooterAr: null, invoiceFooterEn: null,
  depositPercent: 0, depositThreshold: null,
}
const userB = { ...userA, id: uuidv7(), fullName: 'Omar' }
const session = (accessToken = 'tok-1', user = userA, expiresIn = 900): SessionResponse => ({ accessToken, expiresIn, user, branch })
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

interface Call { path: string; init?: RequestInit }
/** A scripted server: each request takes the next response (or throws when given an Error). */
function fakeServer(...script: (Response | Error)[]) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ path: new URL(url).pathname.replace('/api/v1/auth', ''), init })
    const next = script.shift() ?? json({ error: 'unexpected call' }, 500)
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}
const offline = () => new TypeError('Failed to fetch')
const queueSomething = () => db.outbox.add(newMutation('customers:insert', uuidv7(), { full_name: 'X', phone_e164: '+96170111222' }))

beforeEach(async () => { await Promise.all(db.tables.map((t) => t.clear())) })

describe('login', () => {
  it('signs in, remembers the user, keeps the token in memory and sends the refresh cookie flag', async () => {
    const server = fakeServer(json(session()))
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: server.fetchImpl })
    expect(await auth.login(' rana@shop.example ', 'secret')).toMatchObject({ fullName: 'Rana' })
    expect(auth.getState()).toMatchObject({ status: 'signed_in', user: { fullName: 'Rana' }, branch: { maxDiscountPercent: 10 } })
    expect(await getMeta('session.user')).toMatchObject({ id: userA.id })
    expect(await getMeta('session.branch')).toMatchObject({ baseCurrency: 'USD' })
    expect(await auth.getAccessToken()).toBe('tok-1')                       // no second request needed
    expect(server.calls).toHaveLength(1)
    expect(server.calls[0]!.init).toMatchObject({ credentials: 'include', method: 'POST' })
  })

  it.each([
    [json({ error: 'invalid_credentials' }, 401), InvalidCredentialsError],
    [json({ error: 'invalid_request' }, 400), InvalidCredentialsError],
    [json({ error: 'too_many_attempts' }, 429, { 'Retry-After': '120' }), TooManyAttemptsError],
    [json({ error: 'internal_error' }, 500), ServerError],
    [offline(), NetworkError],
  ])('maps failures to clear errors (%#)', async (response, errorType) => {
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(response).fetchImpl })
    await expect(auth.login('a@b.co', 'x')).rejects.toBeInstanceOf(errorType)
    expect(auth.getState().status).not.toBe('signed_in')
  })

  it('tells the user how long to wait when locked out', async () => {
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(json({}, 429, { 'Retry-After': '120' })).fetchImpl })
    await expect(auth.login('a@b.co', 'x')).rejects.toMatchObject({ retryAfterSeconds: 120 })
  })

  it('a different user cannot inherit unsent work; the fresh session is revoked again', async () => {
    await setMeta('session.user', userA)
    await queueSomething()
    const server = fakeServer(json(session('tok-b', userB)), new Response(null, { status: 204 }))
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: server.fetchImpl })
    await expect(auth.login('omar@shop.example', 'x')).rejects.toBeInstanceOf(PendingChangesError)
    expect(server.calls.map((c) => c.path)).toEqual(['/login', '/logout'])
    expect(await db.outbox.count()).toBe(1)
    expect(auth.getState().status).not.toBe('signed_in')
  })

  it('a different user on a clean device starts with a wiped local database; the same user keeps theirs', async () => {
    await setMeta('session.user', userA)
    await db.customers.put({ id: 'private-customer' })
    const sameUser = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(json(session('t', userA))).fetchImpl })
    await sameUser.login('rana@shop.example', 'x')
    expect(await db.customers.count()).toBe(1)

    const newUser = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(json(session('t', userB))).fetchImpl })
    await newUser.login('omar@shop.example', 'x')
    expect(await db.customers.count()).toBe(0)
    expect(await getMeta('session.user')).toMatchObject({ id: userB.id })
  })
})

describe('startup and offline behaviour', () => {
  it('shows the login screen when nobody was signed in', async () => {
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer().fetchImpl })
    expect(auth.getState().status).toBe('loading')
    await auth.start()
    expect(auth.getState().status).toBe('signed_out')
  })

  it('a remembered user gets the app immediately and stays signed in while offline, with the shop rules intact', async () => {
    await setMeta('session.user', userA)
    await setMeta('session.branch', branch)
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(offline(), offline()).fetchImpl })
    await auth.start()
    expect(auth.getState()).toMatchObject({ status: 'signed_in', user: { id: userA.id }, branch: { maxDiscountPercent: 10 } })
    expect(await auth.getAccessToken()).toBeNull()                          // no token yet, but no error and no sign-out
    expect(auth.getState().status).toBe('signed_in')
  })

  it('refreshes in the background after startup and adopts fresh permissions', async () => {
    await setMeta('session.user', userA)
    const upgraded = { ...userA, permissions: ['orders:read', 'orders:create'] }
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(json(session('tok-fresh', upgraded))).fetchImpl })
    await auth.start()
    expect(await auth.getAccessToken()).toBe('tok-fresh')
    expect(auth.getState()).toMatchObject({ user: { permissions: ['orders:read', 'orders:create'] } })
  })

  it('when the server ends the session the user must sign in again, but unsent work is kept for them', async () => {
    await setMeta('session.user', userA)
    await queueSomething()
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(json({ error: 'invalid_refresh' }, 401)).fetchImpl })
    await auth.start()
    await auth.getAccessToken()
    expect(auth.getState().status).toBe('signed_out')
    expect(await db.outbox.count()).toBe(1)
    const again = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(json(session('t', userA))).fetchImpl })
    await again.login('rana@shop.example', 'x')
    expect(await db.outbox.count()).toBe(1)                                 // same user resumes their queue
  })
})

describe('access token refresh', () => {
  it('refreshes once when the token is about to expire, however many callers ask at the same time', async () => {
    let now = 1_000_000
    const server = fakeServer(json(session('tok-1', userA, 900)), json(session('tok-2', userA, 900)))
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: server.fetchImpl, now: () => now })
    await auth.login('rana@shop.example', 'x')
    now += 700_000                                                          // still valid
    expect(await auth.getAccessToken()).toBe('tok-1')
    now += 200_000                                                          // inside the 30 s safety margin
    const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()])
    expect(tokens).toEqual(['tok-2', 'tok-2', 'tok-2'])
    expect(server.calls.map((c) => c.path)).toEqual(['/login', '/refresh'])
  })

  it('survives a refresh race with another tab by retrying once with the new cookie', async () => {
    let now = 1_000_000
    const server = fakeServer(json(session('tok-1', userA, 60)), json({ error: 'refresh_race' }, 401), json(session('tok-2', userA, 900)))
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: server.fetchImpl, now: () => now })
    await auth.login('rana@shop.example', 'x')
    now += 120_000
    expect(await auth.getAccessToken()).toBe('tok-2')
    expect(auth.getState().status).toBe('signed_in')
  })

  it('does not sign anyone out because of a flaky connection', async () => {
    let now = 1_000_000
    const server = fakeServer(json(session('tok-1', userA, 60)), offline(), json({ error: 'internal_error' }, 500))
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: server.fetchImpl, now: () => now })
    await auth.login('rana@shop.example', 'x')
    now += 120_000
    expect(await auth.getAccessToken()).toBeNull()
    expect(await auth.getAccessToken()).toBeNull()
    expect(auth.getState().status).toBe('signed_in')
  })
})

describe('logout', () => {
  it('refuses to drop unsent changes unless told to, and wipes the device when it does sign out', async () => {
    const server = fakeServer(json(session()), new Response(null, { status: 204 }))
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: server.fetchImpl })
    await auth.login('rana@shop.example', 'x')
    await db.customers.put({ id: 'c1' })
    await queueSomething()

    await expect(auth.logout()).rejects.toMatchObject({ pending: 1 })
    expect(auth.getState().status).toBe('signed_in')
    expect(await db.customers.count()).toBe(1)

    await auth.logout({ discardUnsent: true })
    expect(auth.getState().status).toBe('signed_out')
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(db.tables.map(() => 0))
    expect(await auth.getAccessToken()).toBeNull()
    expect(server.calls.at(-1)!.path).toBe('/logout')
  })

  it('signs out locally even when the network is down', async () => {
    const auth = createAuthClient({ baseUrl: 'http://api.test', fetchImpl: fakeServer(json(session()), offline()).fetchImpl })
    await auth.login('rana@shop.example', 'x')
    await auth.logout()
    expect(auth.getState().status).toBe('signed_out')
  })
})
