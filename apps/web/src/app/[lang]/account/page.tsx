import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, ORDER_STATUS_LABELS } from "@mpe/shared";
import { AccountArea } from "@/components/account/account-area";
import { getDictionary } from "@/lib/dictionaries";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/[lang]/account">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  return (
    <section className="pt-6">
      <h1 className="text-4xl font-extrabold">{dict.account.title}</h1>
      <div className="mt-8"><AccountArea lang={lang} t={dict.account} statusLabels={Object.fromEntries(Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => [k, v[lang]]))} /></div>
    </section>
  );
}
