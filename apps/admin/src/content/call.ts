import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { ContentError, KNOWN_ERROR_CODES, type ContentErrorCode } from './api'

/**
 * One way of talking to the admin API, for every online-only area of the staff app (orders, team, quotes, reports,
 * proofs, push, templates, company invoices, customer accounts). Each of those used to carry its own copy of this
 * function; the copies had already drifted apart on whether they handled 204, how they decided to send a
 * Content-Type, and whether they checked the server's error code against the ones the screens have text for.
 *
 * The staff app works offline, so the distinction this makes matters more than it looks: a request that never left
 * the device is `offline` (the screen says "no connection, this will wait"), while a request the server answered is
 * a real failure the person has to act on.
 *
 * `fetch` is called through the global on purpose rather than captured once, so a test that replaces
 * `globalThis.fetch` is still seen by calls made afterwards.
 */

const codeOf = (error: string | undefined): ContentErrorCode =>
  KNOWN_ERROR_CODES.includes(error as ContentErrorCode) ? (error as ContentErrorCode) : 'server'

/** No token means either a signed-out session or, far more often in a print shop, no connection right now. */
async function token(): Promise<string> {
  const value = await auth.getAccessToken()
  if (!value) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
  return value
}

/** The admin API area this client talks to, e.g. `adminApi('team')` for /api/v1/admin/team. */
export function adminApi(area: string) {
  const base = `${API_URL}/api/v1/admin/${area}`

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const bearer = await token()
    // FormData sets its own Content-Type, including the multipart boundary; naming it here would corrupt the upload.
    const isForm = body instanceof FormData
    let res: Response
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${bearer}`, ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      })
    } catch {
      throw new ContentError('offline')                       // the request never reached the server
    }
    if (res.status === 204) return undefined as T             // deliberately empty answer, nothing to parse
    const parsed = await res.json().then((value: unknown) => ({ value }), () => null)
    if (!res.ok) {
      const payload = parsed?.value as { error?: string; message?: string } | null
      return Promise.reject(new ContentError(codeOf(payload?.error), payload?.message))
    }
    // A success the app cannot read is a failure, not an empty result: every endpoint here answers either 204 or
    // JSON, so an unparseable body means something else answered (a captive portal on the shop's wifi, a proxy
    // error page). Handing the screens `null` instead would quietly show them an empty report.
    if (!parsed) throw new ContentError('server')
    return parsed.value as T
  }

  /**
   * A download that needs the bearer token, so a plain link cannot fetch it: returns a local URL the caller can
   * click and then revoke. Used for a customer's design file and for the CSV of a report.
   */
  async function blobUrl(path: string): Promise<string> {
    // `unauthorized` rather than the offline/unauthorized split above: a download is always started by a tap on a
    // row the person is already looking at, so "sign in again" is the useful answer either way.
    const bearer = await auth.getAccessToken()
    if (!bearer) throw new ContentError('unauthorized')
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${bearer}` } })
    if (!res.ok) throw new ContentError('server')
    return URL.createObjectURL(await res.blob())
  }

  return { call, blobUrl }
}
