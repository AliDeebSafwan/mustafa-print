import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from 'react-i18next'

/** New versions wait for the user: never reload in the middle of scanning an order. */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW()
  if (!needRefresh && !offlineReady) return null
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-10 flex items-center justify-between gap-3 border border-ink bg-paper p-3 shadow-lg sm:inset-x-auto sm:end-4 sm:w-96">
      <p className="text-sm">{needRefresh ? t('update.ready') : t('update.offlineReady')}</p>
      <div className="flex gap-2">
        {needRefresh && <button className="bg-ink px-3 py-1 text-sm font-semibold text-white" onClick={() => updateServiceWorker(true)}>{t('update.apply')}</button>}
        <button className="border border-ink px-3 py-1 text-sm" onClick={() => { setNeedRefresh(false); setOfflineReady(false) }}>{t('update.later')}</button>
      </div>
    </div>
  )
}
