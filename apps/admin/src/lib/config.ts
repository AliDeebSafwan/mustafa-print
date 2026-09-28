/** Base URL of the API. Set at build time (see .env.example). */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
/** Public customer website: the tracking link printed on labels as a QR code. */
export const PUBLIC_WEB_URL: string = (import.meta.env.VITE_PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '')
/** Country calling code applied to phone numbers typed without one (Lebanon = 961). */
export const DEFAULT_CALLING_CODE: string = import.meta.env.VITE_DEFAULT_CALLING_CODE ?? '961'
