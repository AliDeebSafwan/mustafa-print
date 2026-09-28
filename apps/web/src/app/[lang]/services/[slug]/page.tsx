import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { GalleryGrid } from "@/components/gallery-grid";
import { Picture } from "@/components/picture";
import { ProductGrid } from "@/components/product-grid";
import { getDictionary } from "@/lib/dictionaries";
import { fill } from "@/lib/i18n";
import { alternates } from "@/lib/seo";
import { getGallery, getProducts, getService, getSite, imageAttrs, publicApiUrl, whatsappLink } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]/services/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const service = await getService(lang, slug);
  if (!service) return {};
  return {
    title: service.title,
    description: service.summary ?? undefined,
    alternates: alternates(lang, `/services/${slug}`),
    openGraph: service.image ? { images: [{ url: imageAttrs(service.image).src, alt: service.image.alt }] } : undefined,
  };
}

export default async function ServicePage({ params }: PageProps<"/[lang]/services/[slug]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, service, site] = await Promise.all([getDictionary(lang), getService(lang, slug), getSite(lang)]);
  if (!service) notFound();
  const [work, products] = await Promise.all([getGallery(lang, slug), getProducts(lang, slug)]);
  const currency = site?.currency ?? "USD";

  return (
    <article className="pt-6">
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <h1 className="text-4xl font-extrabold">{service.title}</h1>
          {service.summary && <p className="mt-4 text-lg leading-8 text-muted">{service.summary}</p>}
          {service.body && <div className="mt-6 leading-8 whitespace-pre-line">{service.body}</div>}
          {site?.whatsapp && (
            <a className="mt-8 inline-block bg-ink px-5 py-3 font-bold text-paper" target="_blank" rel="noopener noreferrer"
              href={whatsappLink(site.whatsapp, fill(dict.services.askMessage, { name: service.title }))}>{dict.services.ask}</a>
          )}
        </div>
        {service.image && <Picture image={service.image} sizes="(min-width: 768px) 50vw, 100vw" className="w-full bg-tint object-cover" priority />}
      </div>
      {products.length > 0 && (
        <section className="mt-16">
          <h2 className="text-2xl font-extrabold">{dict.services.order}</h2>
          <div className="mt-6"><ProductGrid products={products} dict={dict} currency={currency} whatsapp={site?.whatsapp ?? null} /></div>
        </section>
      )}
      {work.length > 0 && (
        <section className="mt-16">
          <h2 className="text-2xl font-extrabold">{dict.services.related}</h2>
          <div className="mt-6"><GalleryGrid items={work} labels={dict.gallery} apiBase={publicApiUrl()} /></div>
        </section>
      )}
    </article>
  );
}
