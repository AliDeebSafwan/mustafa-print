/**
 * Addresses baked in at build time (see .env.example). Each has a development fallback, and none of those fallbacks may
 * reach a production build: a staff app built without its settings must still work, or fail visibly, never quietly
 * talk to localhost.
 */

/** The API. Without VITE_API_URL a production build calls its own origin, which is exactly how it is deployed: Caddy
 *  serves the API under the staff app's own domain (/api/*). */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : globalThis.location.origin)).replace(/\/$/, '')

/** The customer website, for the tracking link printed on labels. It lives on another domain, so it cannot be guessed:
 *  null in a production build that was not given it (better a label without a link than one pointing at localhost). */
const website = import.meta.env.VITE_PUBLIC_WEB_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : null)
export const PUBLIC_WEB_URL: string | null = website ? website.replace(/\/$/, '') : null

/** Country calling code applied to phone numbers typed without one (Lebanon = 961). */
export const DEFAULT_CALLING_CODE: string = import.meta.env.VITE_DEFAULT_CALLING_CODE ?? '961'
