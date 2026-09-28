import Link from "next/link";
import type { Locale, PublicSite } from "@mpe/shared";
import type { Dictionary } from "@/lib/dictionaries";
import { whatsappLink } from "@/lib/site";

/** How to reach the shop, on every page. Only what the owner filled in is shown. */
export function SiteFooter({ site, dict, lang }: { site: PublicSite | null; dict: Dictionary; lang: Locale }) {
  const social = Object.entries(site?.social ?? {});
  return (
    <footer className="mx-auto mt-24 max-w-5xl border-t border-rule px-5 py-10 text-sm">
      <div className="grid gap-8 sm:grid-cols-3">
        <div>
          <p className="font-extrabold">{dict.brand}</p>
          {site?.address && <p className="mt-2 leading-6 text-muted">{site.address}</p>}
          {site?.mapUrl && <a className="mt-1 inline-block font-semibold underline underline-offset-4" href={site.mapUrl} target="_blank" rel="noopener noreferrer">{dict.contact.map}</a>}
        </div>
        <div className="flex flex-col gap-1">
          {site?.phone && <a className="font-semibold" href={`tel:${site.phone}`} dir="ltr">{site.phone}</a>}
          {site?.whatsapp && <a className="font-semibold underline underline-offset-4" href={whatsappLink(site.whatsapp)} target="_blank" rel="noopener noreferrer">{dict.contact.whatsapp}</a>}
          {site?.email && <a className="font-semibold" href={`mailto:${site.email}`} dir="ltr">{site.email}</a>}
        </div>
        <div>
          {site && site.hours.length > 0 && (
            <>
              <p className="font-bold">{dict.contact.hours}</p>
              <ul className="mt-1 text-muted">{site.hours.map((h) => <li key={h.days}>{h.days}: <span dir="ltr">{h.opens} - {h.closes}</span></li>)}</ul>
            </>
          )}
          {social.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-3">
              {social.map(([network, url]) => <li key={network}><a className="font-semibold capitalize underline underline-offset-4" href={url} target="_blank" rel="noopener noreferrer">{network}</a></li>)}
            </ul>
          )}
        </div>
      </div>
      <p className="mt-10 flex flex-wrap gap-x-4 gap-y-1 text-muted">
        <span>© {new Date().getFullYear()} {site?.legalName || dict.brand}. {dict.footer.rights}</span>
        <Link className="underline underline-offset-4" href={`/${lang}/privacy`}>{dict.legal.privacyTitle}</Link>
        <Link className="underline underline-offset-4" href={`/${lang}/terms`}>{dict.legal.termsTitle}</Link>
      </p>
    </footer>
  );
}
