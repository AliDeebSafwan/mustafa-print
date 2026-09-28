import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { CropMarks } from "@/components/crop-marks";
import { GalleryGrid } from "@/components/gallery-grid";
import { Picture } from "@/components/picture";
import { ServiceCard } from "@/components/service-card";
import { TrackForm } from "@/components/track-form";
import { getDictionary } from "@/lib/dictionaries";
import { alternates, siteUrl } from "@/lib/seo";
import { getGallery, getServices, getSite, imageAttrs, publicApiUrl, whatsappLink } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return { alternates: alternates(lang, "/") };
}

/** Featured first; if the owner featured nothing yet, the first few published. */
const pickFeatured = <T extends { featured: boolean }>(all: T[], count: number) => {
  const featured = all.filter((x) => x.featured);
  return (featured.length > 0 ? featured : all).slice(0, count);
};

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, site, services, gallery] = await Promise.all([getDictionary(lang), getSite(lang), getServices(lang), getGallery(lang)]);
  const shownServices = pickFeatured(services, 6);
  const shownWork = pickFeatured(gallery, 6);

  // What search engines show on a map result: the shop, its phone, address, hours, and photo.
  const business = {
    "@context": "https://schema.org", "@type": "LocalBusiness", name: dict.brand, url: `${siteUrl()}/${lang}`,
    ...(site?.phone ? { telephone: site.phone } : {}), ...(site?.email ? { email: site.email } : {}),
    ...(site?.address ? { address: site.address } : {}),
    ...(site?.hero ? { image: imageAttrs(site.hero).src } : {}),
    ...(site?.hours.length ? { openingHours: site.hours.map((h) => `${h.days} ${h.opens}-${h.closes}`) } : {}),
    ...(Object.values(site?.social ?? {}).length ? { sameAs: Object.values(site!.social) } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(business).replace(/</g, "\\u003c") }} />

      <section className="grid items-center gap-10 pt-6 pb-16 sm:pt-14 md:grid-cols-2">
        <div>
          <h1 className="text-4xl leading-[1.3] font-extrabold sm:text-5xl sm:leading-[1.25]">{site?.tagline ?? dict.hero.title}</h1>
          <p className="mt-6 text-lg leading-8 text-muted">{dict.hero.subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {site?.whatsapp && (
              <a className="bg-ink px-5 py-3 font-bold text-paper" href={whatsappLink(site.whatsapp)} target="_blank" rel="noopener noreferrer">{dict.hero.whatsapp}</a>
            )}
            <Link className="border border-ink px-5 py-3 font-bold" href={`/${lang}/gallery`}>{dict.hero.seeWork}</Link>
          </div>
        </div>
        {site?.hero && <Picture image={site.hero} sizes="(min-width: 768px) 50vw, 100vw" className="w-full bg-tint object-cover" priority />}
      </section>

      {shownServices.length > 0 && (
        <section id="services" className="scroll-mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-3xl font-extrabold">{dict.home.services}</h2>
            <Link className="text-sm font-semibold underline underline-offset-4" href={`/${lang}/services`}>{dict.home.allServices}</Link>
          </div>
          <ul className="mt-6 grid border-t border-rule sm:grid-cols-2 sm:gap-x-12">
            {shownServices.map((s) => <ServiceCard key={s.slug} service={s} lang={lang} moreLabel={dict.services.more} />)}
          </ul>
        </section>
      )}

      {shownWork.length > 0 && (
        <section className="mt-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-3xl font-extrabold">{dict.home.work}</h2>
            <Link className="text-sm font-semibold underline underline-offset-4" href={`/${lang}/gallery`}>{dict.home.allWork}</Link>
          </div>
          <div className="mt-6"><GalleryGrid items={shownWork} labels={dict.gallery} apiBase={publicApiUrl()} /></div>
        </section>
      )}

      <section id="track" className="relative mt-20 scroll-mt-8 bg-tint p-8 sm:p-12">
        <CropMarks />
        <h2 className="text-2xl font-extrabold">{dict.home.trackTitle}</h2>
        <div className="mt-4 max-w-2xl"><TrackForm lang={lang} labels={dict.track} /></div>
      </section>
    </>
  );
}
