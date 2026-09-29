import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { CartView } from "@/components/cart/cart-view";
import { getDictionary } from "@/lib/dictionaries";
import { getSite, publicApiUrl } from "@/lib/site";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CartPage({ params }: PageProps<"/[lang]/cart">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, site] = await Promise.all([getDictionary(lang), getSite(lang)]);
  return (
    <>
      <PageHeader title={dict.cart.title} />
      <section className="mt-10">
      <CartView lang={lang} t={dict.cart} checkoutLabel={dict.cart.checkout} apiBase={publicApiUrl()} currency={site?.currency ?? "USD"} />
    </section>
    </>
  );
}
