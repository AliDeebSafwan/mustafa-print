import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { LegalPage } from "@/components/legal-page";
import { getDictionary } from "@/lib/dictionaries";
import { privacyPolicy } from "@/lib/legal";
import { alternates } from "@/lib/seo";
import { getSite } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.legal.privacyTitle, alternates: alternates(lang, "/privacy") };
}

export default async function Page({ params }: PageProps<"/[lang]/privacy">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, site] = await Promise.all([getDictionary(lang), getSite(lang)]);
  // The shop's registered name, address and email come from settings, so changing them never needs a developer.
  const facts = { name: site?.legalName || site?.name || dict.brand, address: site?.address ?? null, email: site?.email ?? null, phone: site?.phone ?? null, contactPath: `/${lang}/contact` };
  return <LegalPage title={dict.legal.privacyTitle} updatedLabel={dict.legal.updated} sections={privacyPolicy(facts, lang)} lang={lang} />;
}
