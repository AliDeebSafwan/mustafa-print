import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { notFound } from "next/navigation";
import { isLocale } from "@mpe/shared";
import { ServiceCard } from "@/components/service-card";
import { getDictionary } from "@/lib/dictionaries";
import { alternates } from "@/lib/seo";
import { getServices } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[lang]/services">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: dict.services.title, description: dict.services.intro, alternates: alternates(lang, "/services") };
}

export default async function ServicesPage({ params }: PageProps<"/[lang]/services">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, services] = await Promise.all([getDictionary(lang), getServices(lang)]);
  return (
    <>
      <PageHeader title={dict.services.title} intro={dict.services.intro} />
      <section className="mt-10">
      {services.length === 0 ? <p className="mt-10 text-muted">{dict.services.empty}</p> : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">
          {services.map((s, i) => <ServiceCard key={s.slug} service={s} lang={lang} heading="h2" priority={i < 2} />)}
        </ul>
      )}
    </section>
    </>
  );
}
