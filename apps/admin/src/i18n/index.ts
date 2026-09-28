import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LOCALE, dirFor, isLocale, type Locale } from '@mpe/shared'
import ar from './ar.json'
import en from './en.json'

const stored = localStorage.getItem('mpe.lang')
const initial: Locale = isLocale(stored) ? stored : navigator.language.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LOCALE

/** Keeps <html lang dir> in sync so RTL/LTR layout, fonts and screen readers follow the chosen language. */
export function applyDocumentLanguage(lng: string) {
  const locale: Locale = isLocale(lng) ? lng : DEFAULT_LOCALE
  document.documentElement.lang = locale
  document.documentElement.dir = dirFor(locale)
}

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: initial,
  fallbackLng: DEFAULT_LOCALE,
  // One namespace only, and several keys contain ':' (mutation kinds such as "orders:insert").
  // Without this, i18next would read everything before the colon as a namespace and find nothing.
  nsSeparator: false,
  interpolation: { escapeValue: false },
})
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('mpe.lang', lng)
  applyDocumentLanguage(lng)
})
applyDocumentLanguage(initial)

export default i18n
