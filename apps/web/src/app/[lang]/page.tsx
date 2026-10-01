import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { isLocale } from "@mpe/shared";
import { CropMarks } from "@/components/ui/crop-marks";
import { Magnetic } from "@/components/ui/magnetic";
import { GalleryGrid } from "@/components/gallery-grid";
import { Picture } from "@/components/ui/picture";
import { ServiceCard } from "@/components/service-card";
import { TrackForm } from "@/components/track-form";
import { getDictionary } from "@/lib/dictionaries";
import { alternates, siteUrl } from "@/lib/seo";
import { CashIcon, ProofIcon, TrackIcon, WhatsAppIcon } from "@/components/ui/icons";
import { getGallery, getServices, getSite, imageAttrs, publicApiUrl, whatsappLink } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return { alternates: alternates(lang, "/") };
}

const PROMISE_ICONS = [[ProofIcon, "bg-cyan text-[#04121f] shadow-[0_0_24px_-4px_var(--cyan)]"], [TrackIcon, "bg-magenta text-on-magenta shadow-[0_0_24px_-4px_var(--magenta)]"], [CashIcon, "bg-yellow text-[#1d1600] shadow-[0_0_24px_-4px_var(--yellow)]"]] as const;

/** Featured first; if the owner featured nothing yet, the first few published. */
const pickFeatured = <T extends { featured: boolean }>(all: T[], count: number) => {
  const featured = all.filter((x) => x.featured);
  return (featured.length > 0 ? featured : all).slice(0, count);
};

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, site, services, gallery] = await Promise.all([getDictionary(lang), getSite(lang), getServices(lang), getGallery(lang)]);
  // The ink layers are the first thing painted on this page: fetch them with the HTML, not after the stylesheet.
  for (const ink of ["c", "m", "y"]) preload(`/art/halftone-${ink}.svg`, { as: "image", fetchPriority: "high" });
  const shownServices = pickFeatured(services, 6);
  // five fills the showroom mosaic exactly: one large piece and four beside it
  const shownWork = pickFeatured(gallery, 5);

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

      <section className="full relative overflow-hidden pt-5 pb-14 sm:pt-12 sm:pb-24">
        <div className="grid items-center gap-7 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
          <div className="relative z-10">
            <h1 className="t-hero t-glow">{site?.tagline ?? dict.hero.title}</h1>
            <p className="t-lead mt-4 max-w-xl sm:mt-5">{dict.hero.subtitle}</p>
            <div className="mt-7 flex flex-wrap gap-2.5 sm:mt-8 sm:gap-3">
              {site?.whatsapp && (
                <Magnetic>
                  <a className="btn btn-ink max-sm:px-4" href={whatsappLink(site.whatsapp)} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon className="size-5" />{dict.hero.whatsapp}
                  </a>
                </Magnetic>
              )}
              <Magnetic><Link className="btn btn-outline max-sm:px-4" href={`/${lang}/gallery`}>{dict.hero.seeWork}</Link></Magnetic>
            </div>
          </div>
          {/* On a phone the picture comes first and short, so the whole offer fits the first screen; on a wide screen it sits beside. */}
          <div className="relative order-first h-[15rem] lg:order-none lg:mx-auto lg:aspect-square lg:h-auto lg:w-full lg:max-w-[34rem]">
            <div aria-hidden className="absolute inset-y-0 end-0 aspect-square lg:inset-0 lg:aspect-auto">
              {/* A glow behind the inks, so the light has somewhere to come from. */}
              <div className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgb(0_242_254/.28),rgb(127_0_255/.16)_45%,transparent_70%)] blur-2xl" />
              {/* The three process inks as halftone dots of light; added together ("screen") the overlaps brighten toward white. */}
              {(["c", "m", "y"] as const).map((ink) => (
                // eslint-disable-next-line @next/next/no-img-element -- a small static SVG, decorative
                <img key={ink} src={`/art/halftone-${ink}.svg`} alt="" width={1000} height={1000} className={`ink-layer ink-${ink}`} fetchPriority="high" />
              ))}
            </div>
            {site?.hero && (
              <div className="absolute start-[2%] bottom-[5%] w-[64%] -rotate-3 overflow-hidden rounded-2xl bg-stock shadow-[0_0_0_1px_var(--edge),0_30px_60px_-22px_rgb(0_242_254/.5)] lg:bottom-[9%] lg:w-[62%]">
                <Picture image={site.hero} sizes="(min-width: 1024px) 30vw, 64vw" className="aspect-[4/3] w-full object-cover" priority />
              </div>
            )}
            {/* Floating previews of real things on this site: the tracking stages a customer sees, and a featured service.
                Wide screens only: on a phone the whole offer has to fit the first screen. */}
            <Link href={`/${lang}#track`} className="glass float absolute end-[-2%] top-[6%] hidden w-56 p-4 backdrop-blur-md lg:block">
              <p className="flex items-center gap-2 text-xs font-bold text-muted"><span className="status-dot live text-cyan" />{dict.nav.track}</p>
              <ol className="mt-3 space-y-1.5">
                {dict.order.stages.map((name, i) => (
                  <li key={name} className="flex items-center gap-2 text-sm font-semibold">
                    <span className={`size-2 rounded-full ${i === 0 ? "bg-cyan shadow-[0_0_10px_var(--cyan)]" : "bg-rule"}`} />{name}
                  </li>
                ))}
              </ol>
            </Link>
            {shownServices[0] && (
              <Link href={`/${lang}/services/${shownServices[0].slug}`} className="glass float float-late absolute end-[8%] bottom-[-3%] hidden max-w-64 items-center gap-3 p-3 backdrop-blur-md lg:flex">
                {shownServices[0].image && <Picture image={shownServices[0].image} sizes="56px" className="size-14 shrink-0 rounded-xl object-cover" />}
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-muted">{dict.home.services}</span>
                  <span className="font-display block truncate font-extrabold">{shownServices[0].title}</span>
                </span>
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="glass mt-2 p-6 sm:p-8">
        <ul className="grid gap-7 md:grid-cols-3 md:gap-8">
          {dict.home.promises.map((p, i) => {
            const [Icon, tone] = PROMISE_ICONS[i % PROMISE_ICONS.length]!;
            return (
              <li key={p.title} className="flex gap-4">
                <span className={`grid size-12 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="size-6" /></span>
                <div>
                  <h2 className="font-display text-xl font-extrabold">{p.title}</h2>
                  <p className="mt-1 leading-8 text-muted">{p.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {shownServices.length > 0 && (
        <section id="services" className="mt-20 scroll-mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="t-section">{dict.home.services}</h2>
            <Link className="font-display font-bold underline underline-offset-4" href={`/${lang}/services`}>{dict.home.allServices}</Link>
          </div>
          <ul className={`mt-8 grid grid-cols-2 gap-4 md:gap-6 ${shownServices.length % 4 === 0 ? "lg:grid-cols-4" : "md:grid-cols-3"}`}>
            {shownServices.map((s) => <ServiceCard key={s.slug} service={s} lang={lang} />)}
          </ul>
        </section>
      )}

      {shownWork.length > 0 && (
        <section className="mt-24">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="t-section">{dict.home.work}</h2>
            <Link className="font-display font-bold underline underline-offset-4" href={`/${lang}/gallery`}>{dict.home.allWork}</Link>
          </div>
          <div className="mt-8"><GalleryGrid items={shownWork} labels={dict.gallery} apiBase={publicApiUrl()} lead /></div>
        </section>
      )}

      <section className="full halftone-field mt-24 border-y border-rule py-16 sm:py-20">
        <h2 className="t-section">{dict.home.how.title}</h2>
        {/* Four stations on one line of light: the line runs behind the cards on wide screens. */}
        <ol className="relative mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:before:absolute lg:before:inset-x-8 lg:before:top-10 lg:before:h-px lg:before:bg-[linear-gradient(90deg,transparent,var(--cyan),var(--magenta),var(--yellow),transparent)] lg:before:content-['']">
          {dict.home.how.steps.map((step, i) => (
            <li key={step.title} className="glass relative p-6">
              <span aria-hidden className="font-display t-glow block text-6xl leading-none font-black">{i + 1}</span>
              <h3 className="font-display mt-4 text-xl font-extrabold">{step.title}</h3>
              <p className="mt-1.5 leading-8 text-ink-2">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="track" className="glass relative mt-24 scroll-mt-8 p-8 sm:p-12">
        <CropMarks />
        <h2 className="t-section !text-[1.7rem]">{dict.home.trackTitle}</h2>
        <div className="mt-5 max-w-2xl"><TrackForm lang={lang} labels={dict.track} /></div>
      </section>

      {site?.whatsapp && (
        <section className="full on-dark relative mt-24 -mb-24 overflow-hidden bg-[linear-gradient(120deg,#b8005f,#7a00b8_55%,#3b1fa8)] py-16 text-white sm:py-20">
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative */}
          <img src="/art/halftone-y.svg" alt="" aria-hidden width={1000} height={1000} className="pointer-events-none absolute -end-40 -bottom-48 size-[34rem] opacity-40 mix-blend-screen" />
          <div className="relative max-w-2xl">
            <h2 className="t-section">{dict.home.cta.title}</h2>
            <p className="mt-3 text-lg leading-8 text-white/90">{dict.home.cta.text}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className="btn bg-white !text-[#b8005f] hover:bg-white/90" href={whatsappLink(site.whatsapp)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon className="size-5" />{dict.hero.whatsapp}</a>
              <Link className="btn btn-outline" href={`/${lang}/products`}>{dict.home.cta.shop}</Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
