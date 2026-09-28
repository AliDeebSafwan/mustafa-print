import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentError, reportsApi } from '../../content'
import { ghostBtn, inputCls } from '../../lib/ui'

/** Downloads a report as a CSV file. The link needs the same bearer token as everything else, so it is fetched
 *  first and handed to the browser as a local file, exactly like a customer's design-file download. */
export function CsvDownloadButton({ path, filename }: { path: string; filename: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setError(null)
    setBusy(true)
    try {
      const url = await reportsApi.csvUrl(path)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setError(err instanceof ContentError && err.code === 'offline' ? t('site.error.offline') : t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button type="button" className={ghostBtn} disabled={busy} onClick={() => void download()}>{t('reports.exportCsv')}</button>
      {error && <p role="alert" className="mt-1 text-sm font-semibold text-magenta">{error}</p>}
    </div>
  )
}

/** A day picker with quick "today"/"yesterday" shortcuts; reports default to today when no date is chosen. */
export function DatePicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const { t } = useTranslation()
  // Computed once per mount, not read live on every render: the exact instant "today" was evaluated does not
  // matter for a couple of shortcut buttons, and reading the clock directly in the render body is impure.
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const [yesterday] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" className={`${inputCls} w-auto`} value={date} max={today} onChange={(e) => onChange(e.target.value || today)} />
      <button type="button" className={`text-sm font-semibold underline ${date === today ? 'text-muted no-underline' : ''}`} onClick={() => onChange(today)}>{t('reports.today')}</button>
      <button type="button" className={`text-sm font-semibold underline ${date === yesterday ? 'text-muted no-underline' : ''}`} onClick={() => onChange(yesterday)}>{t('reports.yesterday')}</button>
    </div>
  )
}
