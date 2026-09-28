import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { ResetScreen } from "@/components/account/token-screens";
import { getDictionary } from "@/lib/dictionaries";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function Page({ params }: PageProps<"/[lang]/account/reset">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  return (
    <section className="pt-6">
      <h1 className="text-4xl font-extrabold">{dict.account.resetTitle}</h1>
      <div className="mt-8"><ResetScreen lang={lang} t={dict.account} /></div>
    </section>
  );
}
