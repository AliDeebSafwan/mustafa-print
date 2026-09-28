import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ContentErrorMessage } from '../components/site/ContentErrorMessage'
import { ContentError, customerAccountsApi, type AccountCandidate } from '../content'
import { useResource } from '../content/use-resource'
import { db } from '../offline/db'
import { requestSync } from '../offline/request-sync'
import { dateTime, money } from '../lib/format'
import { ghostBtn, inputCls, primaryBtn } from '../lib/ui'

/** Website accounts, for the owner: who signed up online, their orders, and the two things only the owner decides. */
export function CustomerAccountsPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const load = useCallback(() => customerAccountsApi.list(search), [search])
  const { data, error, reload } = useResource(load)

  if (selected) return <AccountDetailView id={selected} onBack={async () => { setSelected(null); await reload() }} />

  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('accounts.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('site.onlineOnly')}</p>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(query) }}>
        <input className={inputCls} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('accounts.search')} aria-label={t('accounts.search')} />
        <button type="submit" className={ghostBtn}>{t('accounts.find')}</button>
      </form>
      <div className="mt-3"><ContentErrorMessage error={error} /></div>
      {data && data.length === 0 && <p className="mt-4 text-muted">{t('accounts.empty')}</p>}
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {data?.map((a) => (
          <li key={a.id}>
            <button type="button" className={`flex w-full items-center justify-between gap-3 py-3 text-start ${a.is_active ? '' : 'opacity-60'}`} onClick={() => setSelected(a.id)}>
              <div className="min-w-0">
                <p className="font-bold">{a.full_name}</p>
                <p className="truncate text-xs text-muted" dir="ltr">{a.email}</p>
                <p className="text-xs text-muted">
                  {a.email_verified_at ? t('accounts.orders', { count: a.order_count }) : t('accounts.unverified')}
                  {!a.is_active ? ` · ${t('accounts.disabled')}` : ''}
                </p>
              </div>
              <span className="arrow-go shrink-0 text-sm text-muted" aria-hidden="true">←</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AccountDetailView({ id, onBack }: { id: string; onBack: () => Promise<void> }) {
  const { t, i18n } = useTranslation()
  const load = useCallback(() => customerAccountsApi.detail(id), [id])
  const { data, error, reload } = useResource(load)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [localQuery, setLocalQuery] = useState('')
  const [localMatches, setLocalMatches] = useState<AccountCandidate[]>([])

  const errorText = (err: unknown) => {
    const detail = err instanceof ContentError ? err.detail : undefined
    if (detail === 'target_has_account') return t('accounts.error.targetHasAccount')
    if (detail === 'not_verified') return t('accounts.error.notVerified')
    if (err instanceof ContentError && err.code === 'offline') return t('site.error.offline')
    return t('common.error')
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage({ kind: 'ok', text: ok })
      requestSync()                     // moved orders and the retired duplicate reach this device's copy
      await reload()
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  async function mergeInto(target: AccountCandidate) {
    if (!window.confirm(t('accounts.confirmMerge', { name: target.full_name }))) return
    await run(() => customerAccountsApi.merge(id, target.id), t('accounts.merged', { name: target.full_name }))
  }

  /** Counter customers already on this device, for when the duplicate has a different name and no shared phone. */
  async function findLocal(text: string) {
    setLocalQuery(text)
    const q = text.trim().toLowerCase()
    if (q.length < 2) return setLocalMatches([])
    const found = await db.customers.filter((c) => !c.deleted_at && c.id !== data?.customer_id &&
      (c.full_name.toLowerCase().includes(q) || (c.phone_e164 ?? '').includes(q))).limit(10).toArray()
    setLocalMatches(found.map((c) => ({ id: c.id, full_name: c.full_name, phone_e164: c.phone_e164, email: c.email ?? null, order_count: 0 })))
  }

  if (!data) return <section className="mx-auto max-w-2xl p-4"><ContentErrorMessage error={error} /></section>

  const candidateRow = (c: AccountCandidate, showOrders: boolean) => (
    <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="font-semibold">{c.full_name}</p>
        <p className="text-xs text-muted" dir="ltr">{[c.phone_e164, c.email].filter(Boolean).join(' · ')}</p>
        {showOrders && <p className="text-xs text-muted">{t('accounts.orders', { count: c.order_count })}</p>}
      </div>
      <button type="button" className={`${ghostBtn} shrink-0 px-3 py-2 text-sm`} disabled={busy} onClick={() => void mergeInto(c)}>{t('accounts.mergeInto')}</button>
    </li>
  )

  return (
    <section className="mx-auto max-w-2xl p-4">
      <button type="button" className="text-sm text-muted underline" onClick={() => void onBack()}>{t('accounts.back')}</button>
      <h1 className="mt-2 text-2xl font-extrabold">{data.full_name}</h1>
      <p className="text-sm text-muted" dir="ltr">{data.email}{data.phone_e164 ? ` · ${data.phone_e164}` : ''}</p>
      <p className="text-sm text-muted">
        {data.email_verified_at ? t('accounts.verifiedOn', { date: dateTime(data.email_verified_at, i18n.language) }) : t('accounts.unverified')}
        {!data.is_active ? ` · ${t('accounts.disabled')}` : ''}
      </p>

      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm font-semibold ${message.kind === 'error' ? 'text-magenta' : 'text-ok'}`}>{message.text}</p>}

      <div className="mt-4">
        {data.is_active ? (
          <button type="button" className={ghostBtn} disabled={busy}
            onClick={() => { if (window.confirm(t('accounts.confirmDisable'))) void run(() => customerAccountsApi.deactivate(id), t('accounts.disabledNow')) }}>
            {t('accounts.disable')}
          </button>
        ) : (
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void run(() => customerAccountsApi.reactivate(id), t('accounts.enabledNow'))}>{t('accounts.enable')}</button>
        )}
      </div>

      <h2 className="mt-6 mb-2 font-bold">{t('accounts.ordersTitle')}</h2>
      {data.orders.length === 0 ? <p className="text-sm text-muted">{t('accounts.noOrders')}</p> : (
        <ul className="divide-y divide-rule border-y border-rule">
          {data.orders.map((o) => (
            <li key={o.id}>
              <Link to={`/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <span className="font-semibold" dir="ltr">{o.order_number ? `#${o.order_number}` : o.public_code}</span>
                <span className="text-sm text-muted">{dateTime(o.placed_at, i18n.language)}</span>
                <span className="font-semibold" dir="ltr">{money(o.total, o.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data.customer_id && (
        <div className="mt-6 border border-rule p-3">
          <h2 className="font-bold">{t('accounts.mergeTitle')}</h2>
          <p className="mt-1 text-xs text-muted">{t('accounts.mergeHelp')}</p>
          {data.candidates.length > 0 && (
            <>
              <p className="mt-3 text-sm font-semibold">{t('accounts.suggested')}</p>
              <ul className="divide-y divide-rule">{data.candidates.map((c) => candidateRow(c, true))}</ul>
            </>
          )}
          <input className={`${inputCls} mt-3`} type="search" value={localQuery} onChange={(e) => void findLocal(e.target.value)}
            placeholder={t('accounts.findCustomer')} aria-label={t('accounts.findCustomer')} />
          {localMatches.length > 0 && <ul className="divide-y divide-rule">{localMatches.map((c) => candidateRow(c, false))}</ul>}
        </div>
      )}
    </section>
  )
}
