import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { CartView } from "@/components/cart/cart-view";
import { getDictionary } from "@/lib/dictionaries";
import { publicApiUrl } from "@/lib/site";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CartPage({ params }: PageProps<"/[lang]/cart">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  return (
    <section className="pt-6">
      <h1 className="text-4xl font-extrabold">{dict.cart.title}</h1>
      <CartView lang={lang} t={dict.cart} checkoutLabel={dict.cart.checkout} apiBase={publicApiUrl()} />
    </section>
  );
}
