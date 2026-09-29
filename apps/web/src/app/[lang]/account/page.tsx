import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
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
    <>
      <PageHeader title={dict.account.title} />
      <section className="mt-10">
      <div className="mt-8"><AccountArea lang={lang} t={dict.account} statusLabels={Object.fromEntries(Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => [k, v[lang]]))} /></div>
    </section>
    </>
  );
}
