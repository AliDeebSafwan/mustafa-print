import type { Metadata } from "next";
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
  const chip = (active: boolean) => `px-3 py-1.5 text-sm font-semibold ${active ? "bg-ink text-paper" : "border border-ink"}`;

  return (
    <section className="pt-6">
      <h1 className="text-4xl font-extrabold">{dict.gallery.title}</h1>
      <p className="mt-3 text-lg text-muted">{dict.gallery.intro}</p>
      {services.length > 0 && (
        <nav className="mt-6 flex flex-wrap gap-2" aria-label={dict.nav.services}>
          <Link href={`/${lang}/gallery`} className={chip(!service)} aria-current={!service ? "page" : undefined}>{dict.gallery.all}</Link>
          {services.map((s) => (
            <Link key={s.slug} href={`/${lang}/gallery?service=${s.slug}`} className={chip(service === s.slug)} aria-current={service === s.slug ? "page" : undefined}>{s.title}</Link>
          ))}
        </nav>
      )}
      <div className="mt-8">
        {items.length === 0 ? <p className="text-muted">{dict.gallery.empty}</p> : <GalleryGrid items={items} labels={dict.gallery} apiBase={publicApiUrl()} />}
      </div>
    </section>
  );
}
