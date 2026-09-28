import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getDictionary } from "@/lib/dictionaries";
import { publicApiUrl } from "@/lib/site";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CheckoutPage({ params }: PageProps<"/[lang]/checkout">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  return (
    <section className="pt-6">
      <h1 className="text-4xl font-extrabold">{dict.checkout.title}</h1>
      <CheckoutForm lang={lang} t={dict.checkout} accountT={dict.account} apiBase={publicApiUrl()} />
    </section>
  );
}
