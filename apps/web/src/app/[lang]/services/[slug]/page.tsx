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
    <>
      <div className="full bg-stock py-10 sm:py-14">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div>
            <h1 className="t-page">{service.title}</h1>
            {service.summary && <p className="t-lead mt-4">{service.summary}</p>}
            {site?.whatsapp && (
              <a className="btn btn-ink mt-7" target="_blank" rel="noopener noreferrer"
                href={whatsappLink(site.whatsapp, fill(dict.services.askMessage, { name: service.title }))}>{dict.services.ask}</a>
            )}
          </div>
          {service.image && (
            <div className="overflow-hidden rounded-2xl shadow-[0_30px_50px_-28px_rgba(14,23,38,.5)]">
              <Picture image={service.image} sizes="(min-width: 768px) 50vw, 100vw" className="aspect-[4/3] w-full object-cover" priority />
            </div>
          )}
        </div>
      </div>
      <article className="mt-12">
      {service.body && <div className="max-w-2xl text-lg leading-9 whitespace-pre-line">{service.body}</div>}
      {products.length > 0 && (
        <section className="mt-14">
          <h2 className="t-section !text-[1.75rem]">{dict.services.order}</h2>
          <div className="mt-7"><ProductGrid products={products} dict={dict} currency={currency} whatsapp={site?.whatsapp ?? null} /></div>
        </section>
      )}
      {work.length > 0 && (
        <section className="mt-16">
          <h2 className="t-section !text-[1.75rem]">{dict.services.related}</h2>
          <div className="mt-7"><GalleryGrid items={work} labels={dict.gallery} apiBase={publicApiUrl()} /></div>
        </section>
      )}
      </article>
    </>
  );
}
