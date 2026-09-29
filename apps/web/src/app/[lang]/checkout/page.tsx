import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getDictionary } from "@/lib/dictionaries";
import { getSite, publicApiUrl } from "@/lib/site";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CheckoutPage({ params }: PageProps<"/[lang]/checkout">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, site] = await Promise.all([getDictionary(lang), getSite(lang)]);
  return (
    <>
      <PageHeader title={dict.checkout.title} />
      <section className="mt-10">
      <CheckoutForm lang={lang} t={dict.checkout} accountT={dict.account} totalLabel={dict.cart.subtotal} currency={site?.currency ?? "USD"} apiBase={publicApiUrl()} />
    </section>
    </>
  );
}
