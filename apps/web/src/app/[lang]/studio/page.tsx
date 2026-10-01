import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { PageHeader } from "@/components/layout/page-header";
import { PrintStudio } from "@/components/studio/print-studio";
import { BoltIcon, CubeIcon, LayersIcon, LeafIcon, SparkIcon } from "@/components/ui/icons";
import { getDictionary } from "@/lib/dictionaries";
import { alternates } from "@/lib/seo";
import { getProducts, getSite, imageAttrs } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]/studio">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.studio.title, description: dict.studio.intro, alternates: alternates(lang, "/studio") };
}

const SOON_ICONS = { "3d": CubeIcon, ai: SparkIcon, instant: BoltIcon, green: LeafIcon, finish: LayersIcon } as const;

/**
 * The studio: build an order line from the shop's real products at their real prices, and see what the shop is
 * preparing next. Those upcoming services are marked "coming soon" in plain sight, carry no price and cannot be
 * ordered: they say what is coming, never that it is here.
 */
export default async function StudioPage({ params }: PageProps<"/[lang]/studio">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, products, site] = await Promise.all([getDictionary(lang), getProducts(lang), getSite(lang)]);
  const t = dict.studio;

  return (
    <>
      <PageHeader title={t.title} intro={t.intro} />

      <section className="mt-10" aria-labelledby="studio-config">
        <h2 id="studio-config" className="t-section !text-[1.75rem]">{t.configTitle}</h2>
        <div className="mt-6">
          {products.length === 0
            ? <p className="text-muted">{t.empty}</p>
            // Picture addresses are worked out here on the server (they need the API address, which never goes to the
            // browser) and handed to the studio as plain attributes.
            : <PrintStudio items={products.map((product) => ({ product, image: product.image ? imageAttrs(product.image) : null }))}
                currency={site?.currency ?? "USD"} lang={lang} t={t} cart={dict.cart} />}
        </div>
      </section>

      <section className="mt-20" aria-labelledby="studio-soon">
        <h2 id="studio-soon" className="t-section !text-[1.75rem]">{t.soonTitle}</h2>
        <p className="t-lead mt-2 max-w-2xl">{t.soonIntro}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.soon.map((item) => {
            const Icon = SOON_ICONS[item.key as keyof typeof SOON_ICONS] ?? CubeIcon;
            return (
              <li key={item.key} className="relative overflow-hidden rounded-[18px] border border-dashed border-[var(--edge)] bg-[rgb(17_24_41/.5)] p-6">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-rule bg-stock text-cyan/80"><Icon className="size-6" /></span>
                  <span className="soon-badge">{t.soonBadge}</span>
                </div>
                <h3 className="font-display mt-4 text-xl font-extrabold">{item.title}</h3>
                <p className="mt-1.5 leading-7 text-muted">{item.text}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
