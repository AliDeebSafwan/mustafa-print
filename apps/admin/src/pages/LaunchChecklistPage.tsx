import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCan } from '../auth'
import { ContentErrorMessage } from '../components/site/ContentErrorMessage'
import { contentApi, teamApi } from '../content'
import { useResource } from '../content/use-resource'
import { listInventory, listProducts } from '../offline/actions'
import type { InventoryRow, ProductRow } from '../offline/db'

interface Check { ok: boolean; label: string; detail?: string }

/**
 * One screen answering "is the shop's data ready to go live?" — every check reads data already entered elsewhere;
 * nothing here is a new kind of record. Some checks need a connection (team, shop settings, website content); the
 * product and inventory counts work offline, since they come from the device's own synced copy.
 */
export function LaunchChecklistPage() {
  const { t } = useTranslation()
  const can = useCan()
  const products = useLiveQuery(listProducts, [], [] as ProductRow[])
  const inventory = useLiveQuery(listInventory, [], [] as InventoryRow[])

  const loadTeam = useCallback(() => teamApi.list(), [])
  const loadBranch = useCallback(() => teamApi.branchSettings.get(), [])
  const loadSite = useCallback(() => contentApi.settings.get(), [])
  const loadServices = useCallback(() => contentApi.services.list(), [])
  const team = useResource(loadTeam)
  const branch = useResource(loadBranch)
  const site = useResource(loadSite)
  const services = useResource(loadServices)

  if (!can('reports:read')) return <section className="mx-auto max-w-2xl p-4"><p className="text-muted">{t('checklist.needsPermission')}</p></section>

  const onlineError = team.error ?? branch.error ?? site.error ?? services.error
  const onlineLoading = team.loading || branch.loading || site.loading || services.loading

  const publicNoPicture = products.filter((p) => p.is_public && !p.cover_media_id).length
  const zeroPrice = products.filter((p) => Number(p.base_price) === 0).length
  const zeroBalance = inventory.filter((i) => Number(i.quantity_on_hand ?? 0) === 0).length
  const publishedServices = services.data?.filter((s) => s.status === 'published').length ?? 0
  const siteAddress = String(site.data?.address_ar ?? site.data?.address_en ?? '').trim()
  const sitePhone = String(site.data?.phone ?? site.data?.whatsapp ?? '').trim()
  const legalName = String(branch.data?.legal_name_ar ?? branch.data?.legal_name_en ?? '').trim()
  const staffBeyondOwner = (team.data?.length ?? 1) - 1

  const sections: { title: string; checks: Check[] }[] = [
    {
      title: t('checklist.products'),
      checks: [
        { ok: products.length > 0, label: t('checklist.productCount', { count: products.length }) },
        { ok: publicNoPicture === 0, label: t('checklist.publicNoPicture', { count: publicNoPicture }) },
        { ok: zeroPrice === 0, label: t('checklist.zeroPrice', { count: zeroPrice }) },
      ],
    },
    {
      title: t('checklist.inventory'),
      checks: [
        { ok: inventory.length > 0, label: t('checklist.inventoryCount', { count: inventory.length }) },
        { ok: zeroBalance === 0, label: t('checklist.zeroBalance', { count: zeroBalance }) },
      ],
    },
    {
      title: t('checklist.team'),
      checks: [{ ok: staffBeyondOwner > 0, label: t('checklist.staffCount', { count: staffBeyondOwner }) }],
    },
    {
      title: t('checklist.shopSettings'),
      checks: [
        { ok: legalName.length > 0, label: legalName ? t('checklist.legalNameSet', { name: legalName }) : t('checklist.legalNameMissing') },
      ],
    },
    {
      title: t('checklist.website'),
      checks: [
        { ok: siteAddress.length > 0, label: siteAddress ? t('checklist.addressSet') : t('checklist.addressMissing') },
        { ok: sitePhone.length > 0, label: sitePhone ? t('checklist.phoneSet') : t('checklist.phoneMissing') },
        { ok: publishedServices > 0, label: t('checklist.servicesCount', { count: publishedServices }) },
      ],
    },
  ]
  const allChecks = sections.flatMap((s) => s.checks)
  const remaining = allChecks.filter((c) => !c.ok).length

  return (
    <section className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-extrabold">{t('checklist.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('checklist.help')}</p>

      <p role="status" className={`mt-4 text-lg font-extrabold ${remaining === 0 ? 'text-ok' : ''}`}>
        {remaining === 0 ? t('checklist.allDone') : t('checklist.remaining', { count: remaining })}
      </p>

      {onlineLoading && <p className="mt-4 text-sm text-muted">{t('login.loading')}</p>}
      <ContentErrorMessage error={onlineError} />

      {sections.map((s) => (
        <div key={s.title} className="mt-5">
          <h2 className="font-bold">{s.title}</h2>
          <ul className="mt-1.5 flex flex-col gap-1">
            {s.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-sm">
                <span aria-hidden="true" className={c.ok ? 'text-ok' : 'text-magenta'}>{c.ok ? '✓' : '○'}</span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
