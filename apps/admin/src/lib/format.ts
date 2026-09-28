import type { TFunction } from 'i18next'
import { isLocale, type Locale } from '@mpe/shared'

export const money = (value: string | number | undefined, currency = 'USD'): string => `${Number(value ?? 0).toFixed(2)} ${currency}`

export const asLocale = (lang: string): Locale => (isLocale(lang) ? lang : 'ar')

/** Human text for the reason codes the server sends back ("forbidden: missing permission ..." -> a sentence). */
export function reasonText(t: TFunction, reason: string | undefined): string {
  const code = (reason ?? '').split(':')[0]?.trim() ?? ''
  const key = `reason.${code}`
  return t(key, { defaultValue: t('reason.unknown') })
}

export const dateTime = (iso: string | undefined, lang: string): string =>
  iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar-u-nu-latn' : 'en', { dateStyle: 'medium', timeStyle: 'short' }) : ''
