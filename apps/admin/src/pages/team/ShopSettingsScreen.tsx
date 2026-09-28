import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContentErrorMessage } from '../../components/site/ContentErrorMessage'
import { ContentError, teamApi, type BranchSettingsRow } from '../../content'
import { useResource } from '../../content/use-resource'
import { cleanDecimal } from '../../offline/order-draft'
import { inputCls, labelCls, primaryBtn } from '../../lib/ui'

export function ShopSettingsScreen() {
  const load = useCallback(() => teamApi.branchSettings.get(), [])
  const { data, error, reload } = useResource(load)
  if (!data) return <ContentErrorMessage error={error} />
  return <SettingsForm key={data.row_version} row={data} onSaved={reload} />
}

function SettingsForm({ row, onSaved }: { row: BranchSettingsRow; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const [cap, setCap] = useState(row.max_discount_percent ?? '')
  const [legalNameAr, setLegalNameAr] = useState(row.legal_name_ar ?? '')
  const [legalNameEn, setLegalNameEn] = useState(row.legal_name_en ?? '')
  const [taxNumber, setTaxNumber] = useState(row.tax_number ?? '')
  const [vatEnabled, setVatEnabled] = useState(row.vat_enabled)
  const [vatRate, setVatRate] = useState(row.vat_rate_percent)
  const [footerAr, setFooterAr] = useState(row.invoice_footer_ar ?? '')
  const [footerEn, setFooterEn] = useState(row.invoice_footer_en ?? '')
  const [depositPercent, setDepositPercent] = useState(row.deposit_percent)
  const [depositThreshold, setDepositThreshold] = useState(row.deposit_threshold ?? '')
  const [summaryEmail, setSummaryEmail] = useState(row.summary_email ?? '')
  const [summaryHour, setSummaryHour] = useState(row.summary_hour)
  const [error, setError] = useState<ContentError | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save() {
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      await teamApi.branchSettings.save(row, {
        max_discount_percent: cap.trim() ? Number(cap) : null,
        legal_name_ar: legalNameAr.trim() || null, legal_name_en: legalNameEn.trim() || null, tax_number: taxNumber.trim() || null,
        vat_enabled: vatEnabled, vat_rate_percent: vatRate.trim() ? Number(vatRate) : 0,
        invoice_footer_ar: footerAr.trim() || null, invoice_footer_en: footerEn.trim() || null,
        deposit_percent: depositPercent.trim() ? Number(depositPercent) : 0,
        deposit_threshold: depositThreshold.trim() ? Number(depositThreshold) : null,
        summary_email: summaryEmail.trim() || null, summary_hour: summaryHour,
      })
      setSaved(true)
      await onSaved()
    } catch (err) {
      setError(err instanceof ContentError ? err : new ContentError('server'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className={labelCls}>{t('team.discountCap')}
        <input className={inputCls} dir="ltr" inputMode="decimal" value={cap} onChange={(e) => setCap(cleanDecimal(e.target.value))} placeholder="%" />
        <span className="text-xs font-normal text-muted">{t('team.discountCapHelp')}</span>
      </label>

      <fieldset className="mt-2 flex flex-col gap-3 border border-rule p-3">
        <legend className="px-1 text-sm font-semibold">{t('team.invoice.title')}</legend>
        <p className="text-xs text-muted">{t('team.invoice.help')}</p>

        <label className={labelCls}>{t('team.invoice.legalNameAr')}
          <input className={inputCls} value={legalNameAr} onChange={(e) => setLegalNameAr(e.target.value)} placeholder={t('team.invoice.legalNamePlaceholder')} />
        </label>
        <label className={labelCls}>{t('team.invoice.legalNameEn')}
          <input className={inputCls} dir="ltr" value={legalNameEn} onChange={(e) => setLegalNameEn(e.target.value)} />
        </label>
        <label className={labelCls}>{t('team.invoice.taxNumber')}
          <input className={inputCls} dir="ltr" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={vatEnabled} onChange={(e) => setVatEnabled(e.target.checked)} />
          {t('team.invoice.vatEnabled')}
        </label>
        {vatEnabled && (
          <label className={labelCls}>{t('team.invoice.vatRate')}
            <input className={inputCls} dir="ltr" inputMode="decimal" value={vatRate} onChange={(e) => setVatRate(cleanDecimal(e.target.value))} placeholder="%" />
          </label>
        )}

        <label className={labelCls}>{t('team.invoice.footerAr')}
          <textarea className={inputCls} rows={2} value={footerAr} onChange={(e) => setFooterAr(e.target.value)} />
        </label>
        <label className={labelCls}>{t('team.invoice.footerEn')}
          <textarea className={inputCls} dir="ltr" rows={2} value={footerEn} onChange={(e) => setFooterEn(e.target.value)} />
        </label>
      </fieldset>

      <fieldset className="mt-2 flex flex-col gap-3 border border-rule p-3">
        <legend className="px-1 text-sm font-semibold">{t('team.deposit.title')}</legend>
        <p className="text-xs text-muted">{t('team.deposit.help')}</p>
        <label className={labelCls}>{t('team.deposit.percent')}
          <input className={inputCls} dir="ltr" inputMode="decimal" value={depositPercent} onChange={(e) => setDepositPercent(cleanDecimal(e.target.value))} placeholder="%" />
        </label>
        {Number(depositPercent || 0) > 0 && (
          <label className={labelCls}>{t('team.deposit.threshold')}
            <input className={inputCls} dir="ltr" inputMode="decimal" value={depositThreshold} onChange={(e) => setDepositThreshold(cleanDecimal(e.target.value))} />
            <span className="text-xs font-normal text-muted">{t('team.deposit.thresholdHelp')}</span>
          </label>
        )}
      </fieldset>

      <fieldset className="mt-2 flex flex-col gap-3 border border-rule p-3">
        <legend className="px-1 text-sm font-semibold">{t('team.summary.title')}</legend>
        <p className="text-xs text-muted">{t('team.summary.help')}</p>
        <label className={labelCls}>{t('team.summary.email')}
          <input className={inputCls} dir="ltr" type="email" autoComplete="email" value={summaryEmail} onChange={(e) => setSummaryEmail(e.target.value)} />
        </label>
        {summaryEmail.trim() && (
          <label className={labelCls}>{t('team.summary.hour')}
            <select className={inputCls} value={summaryHour} onChange={(e) => setSummaryHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
            </select>
          </label>
        )}
      </fieldset>

      <ContentErrorMessage error={error} />
      {saved && <p role="status" className="text-sm font-semibold text-ok">{t('team.saved')}</p>}
      <button type="button" className={primaryBtn} disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
    </div>
  )
}
