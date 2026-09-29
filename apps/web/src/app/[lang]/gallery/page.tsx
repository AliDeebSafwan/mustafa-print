import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, SLUG_RE } from "@mpe/shared";
import { GalleryGrid } from "@/components/gallery-grid";
import { getDictionary } from "@/lib/dictionaries";
import { alternates } from "@/lib/seo";
import { getGallery, getServices, publicApiUrl } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]/gallery">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.gallery.title, description: dict.gallery.intro, alternates: alternates(lang, "/gallery") };
}

/** The showroom, with one link per service to narrow it down. The filter is a plain link, so it works without JavaScript. */
export default async function GalleryPage({ params, searchParams }: PageProps<"/[lang]/gallery">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const wanted = (await searchParams).service;
  const service = typeof wanted === "string" && SLUG_RE.test(wanted) ? wanted : undefined;
  const [dict, items, services] = await Promise.all([getDictionary(lang), getGallery(lang, service), getServices(lang)]);
  const chip = (active: boolean) => `btn btn-sm shrink-0 whitespace-nowrap ${active ? "btn-ink" : "btn-outline"}`;

  return (
    <>
      <PageHeader title={dict.gallery.title} intro={dict.gallery.intro} />
      <section className="mt-10">
      {services.length > 0 && (
        <nav className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label={dict.nav.services}>
          <Link href={`/${lang}/gallery`} className={chip(!service)} aria-current={!service ? "page" : undefined}>{dict.gallery.all}</Link>
          {services.map((s) => (
            <Link key={s.slug} href={`/${lang}/gallery?service=${s.slug}`} className={chip(service === s.slug)} aria-current={service === s.slug ? "page" : undefined}>{s.title}</Link>
          ))}
        </nav>
      )}
      <div className="mt-8">
        {items.length === 0 ? <p className="text-muted">{dict.gallery.empty}</p> : <GalleryGrid items={items} labels={dict.gallery} apiBase={publicApiUrl()} eager />}
      </div>
    </section>
    </>
  );
}
