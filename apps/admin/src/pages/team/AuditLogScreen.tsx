import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { teamApi, type AuditEntry } from '../../content'
import { useResource } from '../../content/use-resource'
import { asLocale, dateTime } from '../../lib/format'
import { ghostBtn } from '../../lib/ui'

const PAGE = 50

/** A one-line, plain-language description of a logged action — never the raw action key. */
function describe(t: (key: string, opts?: Record<string, unknown>) => string, entry: AuditEntry): string {
  const details = entry.details as Record<string, unknown>
  switch (entry.action) {
    case 'user.created': return t('team.audit.created', { role: t(`team.role.${String(details.role ?? 'staff')}`) })
    case 'user.role_changed': return t('team.audit.roleChanged', { from: t(`team.role.${String(details.from)}`), to: t(`team.role.${String(details.to)}`) })
    case 'user.permissions_changed': return t('team.audit.permissionsChanged', { n: Array.isArray(details.granted) ? details.granted.length : 0 })
    case 'user.deactivated': return t('team.audit.deactivated')
    case 'user.reactivated': return t('team.audit.reactivated')
    case 'user.password_reset': return t('team.audit.passwordReset')
    case 'user.sessions_ended': return t('team.audit.sessionsEnded')
    case 'user.updated': return t('team.audit.updated')
    case 'branch_settings.updated': return t('team.audit.branchSettings')
    case 'my_password.changed': return t('team.audit.myPassword')
    default: return entry.action
  }
}

export function AuditLogScreen() {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const [before, setBefore] = useState<string | undefined>(undefined)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [hasMore, setHasMore] = useState(true)
  const load = useCallback(() => teamApi.auditLog({ limit: PAGE }), [])
  const { data, error } = useResource(load)

  const shown = before ? entries : (data ?? [])

  async function loadMore() {
    const last = shown.at(-1)
    if (!last) return
    const next = await teamApi.auditLog({ limit: PAGE, before: last.created_at })
    setEntries([...shown, ...next])
    setBefore(last.created_at)
    if (next.length < PAGE) setHasMore(false)
  }

  return (
    <div>
      <ContentErrorMessage error={error} />
      {data && shown.length === 0 && <p className="mt-4 text-muted">{t('team.audit.empty')}</p>}
      <ul className="mt-2 divide-y divide-rule border-y border-rule">
        {shown.map((entry) => (
          <li key={entry.id} className="py-3">
            <p className="font-semibold">{describe(t, entry)}</p>
            <p className="text-xs text-muted">{entry.actor_name ?? t('team.audit.system')} · {dateTime(entry.created_at, lang)}</p>
          </li>
        ))}
      </ul>
      {hasMore && shown.length >= PAGE && <button type="button" className={`${ghostBtn} mt-3 w-full`} onClick={() => void loadMore()}>{t('team.audit.loadMore')}</button>}
    </div>
  )
}
