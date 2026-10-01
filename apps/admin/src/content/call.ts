import { ContentError, KNOWN_ERROR_CODES, type ContentErrorCode } from './api'

/**
 * One request to an online-only admin endpoint. Every such API in this folder is built from this, so signing in,
 * being offline, and the server's error codes are handled the same way everywhere.
 *
 * Nothing here reads the browser's settings or session: both arrive as `deps`, so this module also typechecks and
 * runs outside a browser (the e2e suite drives the website editor's API directly). `adminCall` in ./admin-call.ts
 * is the signed-in staff app's version. `fetchImpl` lets a test answer without a network.
 */
export interface ApiCallDeps {
  baseUrl: string
  getToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

export type ApiCall = <T>(method: string, path: string, body?: unknown) => Promise<T>

/** `basePath` is the part after the origin, e.g. '/api/v1/admin/team'. */
export function createCall(basePath: string, deps: ApiCallDeps): ApiCall {
  const { baseUrl, getToken, fetchImpl } = deps
  return async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getToken()
    // No session: offline is the likelier reason when the browser already knows it has no network.
    if (!token) throw new ContentError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unauthorized')
    const isForm = body instanceof FormData
    let res: Response
    try {
      res = await (fetchImpl ?? fetch)(`${baseUrl}${basePath}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      })
    } catch {
      throw new ContentError('offline')
    }
    if (res.status === 204) return undefined as T
    const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
    if (!res.ok) {
      // Only codes the screens know how to explain are kept; anything else is a server fault from their point of view.
      const code = KNOWN_ERROR_CODES.includes(payload?.error as ContentErrorCode) ? (payload!.error as ContentErrorCode) : 'server'
      throw new ContentError(code, payload?.message)
    }
    return payload as T
  }
}
