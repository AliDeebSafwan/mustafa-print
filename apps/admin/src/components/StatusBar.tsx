import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnline } from '../hooks/use-online'
import { db } from '../offline/db'
import { syncDeps } from '../offline/deps'
import { syncNow } from '../offline/sync'
import { cn } from '../lib/cn'

export function StatusBar() {
  const { t } = useTranslation()
  const online = useOnline()
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const [busy, setBusy] = useState(false)

  return (
    <header className="app-chrome flex items-center justify-between gap-3 border-b border-rule px-4 py-2">
      <span className="text-lg font-extrabold">{t('brand')}</span>
      <div className="flex items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5" role="status">
          <span aria-hidden className={cn('size-2.5 rounded-full', online ? 'bg-ok' : 'bg-warn')} />
          {online ? t('status.online') : t('status.offline')}
        </span>
        {pending > 0 && <span className="rounded-full bg-yellow px-2 py-0.5 font-semibold">{pending} {t('status.pending')}</span>}
        <button
          type="button"
          disabled={busy || !online}
          onClick={async () => { setBusy(true); try { await syncNow(syncDeps) } finally { setBusy(false) } }}
          className="border border-ink px-3 py-1 font-semibold disabled:opacity-40"
        >
          {busy ? t('status.syncing') : t('status.sync')}
        </button>
      </div>
    </header>
  )
}
