import type { Metadata } from "next";
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
    <section className="pt-6">
      <h1 className="text-4xl font-extrabold">{dict.services.title}</h1>
      <p className="mt-3 text-lg text-muted">{dict.services.intro}</p>
      {services.length === 0 ? <p className="mt-10 text-muted">{dict.services.empty}</p> : (
        <ul className="mt-8 grid border-t border-rule sm:grid-cols-2 sm:gap-x-12">
          {services.map((s) => <ServiceCard key={s.slug} service={s} lang={lang} moreLabel={dict.services.more} heading="h2" />)}
        </ul>
      )}
    </section>
  );
}
