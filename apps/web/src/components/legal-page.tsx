import type { Locale } from "@mpe/shared";
import type { LegalSection } from "@/lib/legal";
import { LEGAL_UPDATED } from "@/lib/legal";

/** A legal page: plain, readable, printable. Text comes from lib/legal.ts; the shop's identity from settings. */
export function LegalPage({ title, updatedLabel, sections, lang }: { title: string; updatedLabel: string; sections: LegalSection[]; lang: Locale }) {
  const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-LB" : "en-GB", { dateStyle: "long" }).format(new Date(`${LEGAL_UPDATED}T12:00:00Z`));
  return (
    <article className="mx-auto max-w-3xl pt-6">
      <h1 className="text-4xl font-extrabold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{updatedLabel} {date}</p>
      {sections.map((s) => (
        <section key={s.title} className="mt-8">
          <h2 className="text-xl font-bold">{s.title}</h2>
          {s.paragraphs.map((p, i) => <p key={i} className="mt-3 leading-8">{p}</p>)}
        </section>
      ))}
    </article>
  );
}
