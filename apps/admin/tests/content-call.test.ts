import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one HTTP helper every online-only admin screen now goes through (src/content/call.ts). It replaced nine
 * near-identical copies that had drifted apart, so these tests pin the behaviour the screens depend on: what counts
 * as "offline" versus a real failure, which error codes reach them, and that an upload keeps its own Content-Type.
 * The UI tests cannot cover this — they replace the whole *-api module, so the helper never runs there.
 */
const session = vi.hoisted(() => ({ token: 'tok' as string | null }))
vi.mock('../src/auth', () => ({ auth: { getAccessToken: async () => session.token } }))
vi.mock('../src/lib/config', () => ({ API_URL: 'http://api.test' }))

const { adminApi } = await import('../src/content/call')
const { ContentError } = await import('../src/content/api')

const { call, blobUrl } = adminApi('team')

/** The last request the helper made, so the headers and body can be asserted. */
let seen: { url: string; init: RequestInit }
const answer = (body: unknown, status = 200, type = 'application/json') => {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    seen = { url: String(url), init }
    if (status === 204) return new Response(null, { status: 204 })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } })
  }) as unknown as typeof fetch
}
const refuse = () => { globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch }
const headerOf = (name: string) => (seen.init.headers as Record<string, string>)[name]

beforeEach(() => { session.token = 'tok' })

describe('the shared admin API helper', () => {
  it('puts the area and path together and sends the bearer token', async () => {
    answer([{ id: 'u1' }])
    expect(await call('GET', '/users')).toEqual([{ id: 'u1' }])
    expect(seen.url).toBe('http://api.test/api/v1/admin/team/users')
    expect(headerOf('Authorization')).toBe('Bearer tok')
  })

  it('sends no Content-Type when there is no body, so a GET stays a plain GET', async () => {
    answer([])
    await call('GET', '/users')
    expect(headerOf('Content-Type')).toBeUndefined()
    expect(seen.init.body).toBeUndefined()
  })

  it('sends an object body as JSON', async () => {
    answer({ ok: true })
    await call('POST', '/users', { full_name: 'Rana' })
    expect(headerOf('Content-Type')).toBe('application/json')
    expect(seen.init.body).toBe('{"full_name":"Rana"}')
  })

  it('leaves FormData alone: naming the Content-Type would strip the multipart boundary', async () => {
    answer({ id: 'p1' })
    const form = new FormData()
    form.append('file', new Blob(['x']), 'proof.png')
    await call('POST', '/proofs', form)
    expect(headerOf('Content-Type')).toBeUndefined()
    expect(seen.init.body).toBe(form)
  })

  it('returns nothing for 204 instead of trying to parse an empty body', async () => {
    answer(null, 204)
    await expect(call('POST', '/users/u1/end-sessions')).resolves.toBeUndefined()
  })

  it('passes through an error code the screens have wording for, with the server detail', async () => {
    answer({ error: 'version_conflict', message: 'someone saved first' }, 409)
    await expect(call('PUT', '/branch-settings', {})).rejects.toMatchObject({
      name: 'ContentError', code: 'version_conflict', detail: 'someone saved first',
    })
  })

  it('reports an unrecognised server code as a plain server error', async () => {
    answer({ error: 'some_new_code_the_app_has_no_text_for' }, 400)
    const err = await call('POST', '/users', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContentError)
    expect((err as InstanceType<typeof ContentError>).code).toBe('server')
  })

  it('treats a request that never reached the server as offline, not as a failure', async () => {
    refuse()
    await expect(call('GET', '/users')).rejects.toMatchObject({ code: 'offline' })
  })

  it('treats an unparseable error body as a server error rather than throwing', async () => {
    answer('<html>502 Bad Gateway</html>', 502, 'text/html')
    await expect(call('GET', '/users')).rejects.toMatchObject({ code: 'server' })
  })

  /** A captive portal on the shop's wifi answers 200 with its own HTML. That is a failure, not an empty report. */
  it('treats an unreadable body on a successful response as a failure, not as empty data', async () => {
    answer('<html>sign in to the wifi</html>', 200, 'text/html')
    await expect(call('GET', '/users')).rejects.toMatchObject({ code: 'server' })
  })

  it('still accepts a legitimately null JSON body', async () => {
    answer(null, 200)
    await expect(call('GET', '/users')).resolves.toBeNull()
  })

  /**
   * With no token the answer depends on why: a shop whose connection dropped must not be told to sign in again.
   * `onLine` is set explicitly here because this file runs in Node, where `navigator` exists but `onLine` does not.
   */
  it('blames the connection, not the session, when there is no token and the device is offline', async () => {
    session.token = null
    answer([])
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true })
    await expect(call('GET', '/users')).rejects.toMatchObject({ code: 'offline' })
  })

  it('says unauthorized when there is no token and the device is online', async () => {
    session.token = null
    answer([])
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
    await expect(call('GET', '/users')).rejects.toMatchObject({ code: 'unauthorized' })
  })

  describe('a download that needs the token', () => {
    it('hands back a local URL', async () => {
      answer('csv,bytes', 200, 'text/csv')
      globalThis.URL.createObjectURL = (() => 'blob:local') as unknown as typeof URL.createObjectURL
      expect(await blobUrl('/audit-log?format=csv')).toBe('blob:local')
      expect(seen.url).toBe('http://api.test/api/v1/admin/team/audit-log?format=csv')
    })

    it('refuses without a token, and reports a refused download as a server error', async () => {
      session.token = null
      await expect(blobUrl('/x')).rejects.toMatchObject({ code: 'unauthorized' })
      session.token = 'tok'
      answer({ error: 'forbidden' }, 403)
      await expect(blobUrl('/x')).rejects.toMatchObject({ code: 'server' })
    })
  })
})
