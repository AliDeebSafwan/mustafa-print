import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { ProductGrid } from "@/components/product-grid";
import { getDictionary } from "@/lib/dictionaries";
import { alternates } from "@/lib/seo";
import { getProducts, getSite } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]/products">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.products.title, description: dict.products.intro, alternates: alternates(lang, "/products") };
}

export default async function ProductsPage({ params }: PageProps<"/[lang]/products">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, products, site] = await Promise.all([getDictionary(lang), getProducts(lang), getSite(lang)]);
  const currency = site?.currency ?? "USD";

  return (
    <section className="pt-6">
      <h1 className="text-4xl font-extrabold">{dict.products.title}</h1>
      <p className="mt-3 text-lg text-muted">{dict.products.intro}</p>
      {products.length === 0 ? <p className="mt-10 text-muted">{dict.products.empty}</p> : (
        <div className="mt-8"><ProductGrid products={products} dict={dict} currency={currency} whatsapp={site?.whatsapp ?? null} /></div>
      )}
    </section>
  );
}
