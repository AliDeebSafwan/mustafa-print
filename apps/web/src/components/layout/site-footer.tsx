import Link from "next/link";
import type { Locale, PublicSite } from "@mpe/shared";
import type { Dictionary } from "@/lib/dictionaries";
import { whatsappLink } from "@/lib/site";
import { BrandMark } from "../ui/brand-mark";
import { ColorBar } from "../ui/color-bar";

const LINKS = ["services", "studio", "products", "gallery", "contact"] as const;

/** How to reach the shop, on every page. Only what the owner filled in is shown. */
export function SiteFooter({ site, dict, lang }: { site: PublicSite | null; dict: Dictionary; lang: Locale }) {
  const social = Object.entries(site?.social ?? {});
  const link = "underline-offset-4 hover:underline";
  return (
    <footer className="on-dark mt-24 border-t border-rule bg-deep text-ink">
      <ColorBar />
      <div className="bar grid gap-12 py-14 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="flex items-center gap-3"><BrandMark size={36} /><span className="font-display text-3xl font-extrabold">{dict.brand}</span></p>
          {site?.tagline && <p className="mt-4 max-w-sm leading-8 text-muted">{site.tagline}</p>}
          {site?.whatsapp && <a className="btn btn-order mt-6" href={whatsappLink(site.whatsapp)} target="_blank" rel="noopener noreferrer">{dict.hero.whatsapp}</a>}
        </div>

        <div className="flex flex-col gap-2 text-ink-2">
          {site?.address && <p className="leading-7">{site.address}</p>}
          {site?.mapUrl && <a className={`font-semibold ${link}`} href={site.mapUrl} target="_blank" rel="noopener noreferrer">{dict.contact.map}</a>}
          {site?.phone && <a className={`font-semibold ${link}`} href={`tel:${site.phone}`} dir="ltr">{site.phone}</a>}
          {site?.email && <a className={`font-semibold ${link}`} href={`mailto:${site.email}`} dir="ltr">{site.email}</a>}
          {site && site.hours.length > 0 && (
            <ul className="mt-3 text-muted">{site.hours.map((h) => <li key={h.days}>{h.days}: <span dir="ltr">{h.opens} - {h.closes}</span></li>)}</ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <nav aria-label={dict.nav.menu} className="flex flex-col gap-1.5">
            {LINKS.map((key) => <Link key={key} href={`/${lang}/${key}`} className={`font-display text-lg font-bold ${link}`}>{dict.nav[key]}</Link>)}
            <Link href={`/${lang}#track`} className={`font-display text-lg font-bold ${link}`}>{dict.nav.track}</Link>
          </nav>
          {social.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-muted">
              {social.map(([network, url]) => <li key={network}><a className={`capitalize ${link}`} href={url} target="_blank" rel="noopener noreferrer">{network}</a></li>)}
            </ul>
          )}
        </div>
      </div>
      <div className="border-t border-rule">
        <p className="bar flex flex-wrap gap-x-5 gap-y-1 py-5 text-sm text-muted">
          <span>© {new Date().getFullYear()} {site?.legalName || dict.brand}. {dict.footer.rights}</span>
          <Link className={link} href={`/${lang}/privacy`}>{dict.legal.privacyTitle}</Link>
          <Link className={link} href={`/${lang}/terms`}>{dict.legal.termsTitle}</Link>
        </p>
      </div>
    </footer>
  );
}
