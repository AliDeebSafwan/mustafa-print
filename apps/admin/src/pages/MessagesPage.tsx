import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MissingVariableError, renderTemplate, SAMPLE_TEMPLATE_VALUES, TEMPLATE_VARIABLE_HELP, TEMPLATE_VARIABLES, templateProblems, type TemplateProblem } from '@mpe/shared'
import { useCan } from '../auth'
import { ContentErrorMessage } from '../components/site/ContentErrorMessage'
import { ContentError } from '../content'
import { templatesApi, type TemplateRow } from '../content/templates-api'
import { useResource } from '../content/use-resource'
import { asLocale } from '../lib/format'
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../lib/ui'

/** The words customers receive at each step of their order, and when each is sent. */
export function MessagesPage() {
  const { t } = useTranslation()
  const load = useCallback(() => templatesApi.list(), [])
  const { data, error, reload } = useResource(load)
  const [editing, setEditing] = useState<TemplateRow | null>(null)
  const can = useCan()

  if (editing) return <TemplateForm template={editing} onDone={async () => { setEditing(null); await reload() }} />
  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('messages.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('messages.intro')}</p>
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {data?.map((tpl) => (
          <li key={tpl.id}>
            <button type="button" className={`w-full py-3 text-start ${tpl.is_active ? '' : 'opacity-60'}`} disabled={!can('notifications:templates:write')} onClick={() => setEditing(tpl)}>
              <p className="font-bold">{t(`messages.key.${tpl.template_key}`, { defaultValue: tpl.template_key })}</p>
              <p className="text-xs text-muted">{t(`messages.channel.${tpl.channel}`)} · {tpl.locale === 'ar' ? 'العربية' : 'English'}{tpl.is_active ? '' : ` · ${t('messages.off')}`}</p>
              <p className="mt-1 line-clamp-2 text-sm" dir="auto">{tpl.body}</p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function preview(text: string): { text: string; missing: string[] } {
  try { return { text: renderTemplate(text, SAMPLE_TEMPLATE_VALUES), missing: [] } } catch (err) {
    return err instanceof MissingVariableError ? { text: '', missing: err.names } : { text: '', missing: [] }
  }
}

function TemplateForm({ template, onDone }: { template: TemplateRow; onDone: () => Promise<void> }) {
  const { t, i18n } = useTranslation()
  const lang = asLocale(i18n.language)
  const [body, setBody] = useState(template.body)
  const [subject, setSubject] = useState(template.subject ?? '')
  const [active, setActive] = useState(template.is_active)
  const [approved, setApproved] = useState(template.provider_template_name ?? '')
  const [error, setError] = useState<ContentError | null>(null)
  const isWhatsapp = template.channel === 'whatsapp'
  const edit = { body, subject: template.channel === 'email' ? subject : null, ...(isWhatsapp ? { provider_template_name: approved.trim() || null } : {}) }
  const problems = templateProblems(template, edit)
  const shown = preview(body)

  const describe = (p: TemplateProblem) =>
    p.code === 'unknown_variables' ? t('messages.problem.unknown', { names: p.names.map((n) => `{{${n}}}`).join('، ') })
    : p.code === 'email_needs_subject' ? t('messages.problem.subject')
    : t('messages.problem.whatsapp', { expected: p.expected.map((n) => `{{${n}}}`).join(` ${t('common.thenArrow')} `) })

  async function save() {
    setError(null)
    if (problems.length > 0) return
    try { await templatesApi.save(template, { ...edit, is_active: active }); await onDone() } catch (err) { setError(err instanceof ContentError ? err : new ContentError('server')) }
  }

  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t(`messages.key.${template.template_key}`, { defaultValue: template.template_key })}</h1>
      <p className="text-sm text-muted">{t(`messages.channel.${template.channel}`)} · {template.locale === 'ar' ? 'العربية' : 'English'}</p>

      {isWhatsapp && template.provider_template_name && <p className="mt-3 border-s-4 border-magenta bg-tint p-3 text-sm">{t('messages.whatsappNote')}</p>}

      <div className="mt-4 flex flex-col gap-3">
        {template.channel === 'email' && <label className={labelCls}>{t('messages.subject')}<input className={inputCls} dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>}
        <label className={labelCls}>{t('messages.body')}<textarea className={inputCls} dir="auto" rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">{t('messages.variables')}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {TEMPLATE_VARIABLES.map((v) => (
              <li key={v}><button type="button" className="font-mono text-xs underline" dir="ltr" onClick={() => setBody((b) => `${b}{{${v}}}`)}>{`{{${v}}}`}</button> {TEMPLATE_VARIABLE_HELP[v][lang]}</li>
            ))}
          </ul>
        </details>
        {isWhatsapp && (
          <label className={labelCls}>{t('messages.approvedName')}
            <input className={inputCls} dir="ltr" value={approved} onChange={(e) => setApproved(e.target.value)} />
            <span className="text-xs font-normal text-muted">{t('messages.approvedHelp')}</span>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('messages.active')}</label>

        <div className="border border-rule p-3">
          <p className="text-xs font-semibold text-muted">{t('messages.preview')}</p>
          <p className="mt-1 whitespace-pre-line" dir="auto">{shown.text}</p>
        </div>
        {problems.map((p) => <p key={p.code} role="alert" className="text-sm font-semibold text-magenta">{describe(p)}</p>)}
        <ContentErrorMessage error={error} />
        <div className="flex gap-2">
          <button type="button" className={`${primaryBtn} flex-1`} disabled={problems.length > 0} onClick={() => void save()}>{t('common.save')}</button>
          <button type="button" className={ghostBtn} onClick={() => void onDone()}>{t('common.cancel')}</button>
        </div>
      </div>
    </section>
  )
}
