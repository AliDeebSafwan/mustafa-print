import { Cpu } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Where each machine's live state will go once the printers report it. Nothing is connected yet, so this shows no
 * machine, number or status at all: only what is coming, under a visible "coming soon" badge.
 */
export function MachinesSoon() {
  const { t } = useTranslation()
  return (
    <section className="panel border-dashed p-3" aria-labelledby="machines-soon-title">
      <div className="flex items-start justify-between gap-3">
        <h2 id="machines-soon-title" className="flex items-center gap-2 text-sm font-bold">
          <Cpu aria-hidden className="size-4 text-muted" />
          {t('reports.machinesTitle')}
        </h2>
        <span className="shrink-0 rounded-full border border-yellow/60 bg-yellow/10 px-2.5 py-0.5 text-xs font-bold text-ink">{t('reports.comingSoon')}</span>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted">{t('reports.machinesText')}</p>
    </section>
  )
}
