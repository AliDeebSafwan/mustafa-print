import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { getDictionary } from "@/lib/dictionaries";
import { alternates } from "@/lib/seo";
import { getSite, whatsappLink } from "@/lib/site";
import { PhoneIcon, PinIcon, WhatsAppIcon } from "@/components/icons";

export async function generateMetadata({ params }: PageProps<"/[lang]/contact">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.contact.title, alternates: alternates(lang, "/contact") };
}

export default async function ContactPage({ params }: PageProps<"/[lang]/contact">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, site] = await Promise.all([getDictionary(lang), getSite(lang)]);
  const row = "border-b border-rule py-4";

  return (
    <>
      <PageHeader title={dict.contact.title} />
      {(site?.whatsapp || site?.phone || site?.mapUrl) && (
        <div className="mt-8 flex flex-wrap gap-3">
          {site?.whatsapp && <a className="btn btn-ink" href={whatsappLink(site.whatsapp)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon className="size-5" />{dict.contact.whatsapp}</a>}
          {site?.phone && <a className="btn btn-outline" href={`tel:${site.phone}`}><PhoneIcon className="size-5" />{dict.contact.call}</a>}
          {site?.mapUrl && <a className="btn btn-outline" href={site.mapUrl} target="_blank" rel="noopener noreferrer"><PinIcon className="size-5" />{dict.contact.map}</a>}
        </div>
      )}
      <section className="mt-10">
      {site?.about && (
        <div className="mt-8 max-w-3xl">
          <h2 className="text-xl font-bold">{dict.contact.about}</h2>
          <p className="mt-2 leading-8 whitespace-pre-line text-muted">{site.about}</p>
        </div>
      )}
      <dl className="mt-8 max-w-2xl border-t border-rule">
        {site?.phone && <div className={row}><dt className="text-sm text-muted">{dict.contact.phone}</dt><dd className="text-lg font-bold"><a href={`tel:${site.phone}`} dir="ltr">{site.phone}</a></dd></div>}
        {site?.whatsapp && <div className={row}><dt className="text-sm text-muted">{dict.contact.whatsapp}</dt><dd className="text-lg font-bold"><a className="underline underline-offset-4" href={whatsappLink(site.whatsapp)} target="_blank" rel="noopener noreferrer" dir="ltr">{site.whatsapp}</a></dd></div>}
        {site?.email && <div className={row}><dt className="text-sm text-muted">{dict.contact.email}</dt><dd className="text-lg font-bold"><a href={`mailto:${site.email}`} dir="ltr">{site.email}</a></dd></div>}
        {site?.address && (
          <div className={row}>
            <dt className="text-sm text-muted">{dict.contact.address}</dt>
            <dd className="text-lg font-bold">{site.address}</dd>
            {site.mapUrl && <dd><a className="text-sm font-semibold underline underline-offset-4" href={site.mapUrl} target="_blank" rel="noopener noreferrer">{dict.contact.map}</a></dd>}
          </div>
        )}
        {site && site.hours.length > 0 && (
          <div className={row}>
            <dt className="text-sm text-muted">{dict.contact.hours}</dt>
            {site.hours.map((h) => <dd key={h.days} className="font-semibold">{h.days}: <span dir="ltr">{h.opens} - {h.closes}</span></dd>)}
          </div>
        )}
      </dl>
    </section>
    </>
  );
}
