import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PUBLIC_CODE_RE, isLocale } from "@mpe/shared";
import { ProofActions } from "@/components/proof/proof-actions";
import { fetchProof } from "@/lib/api";
import { getDictionary } from "@/lib/dictionaries";

export const metadata: Metadata = { robots: { index: false, follow: false } };   // proof links are private

export default async function ProofPage({ params }: PageProps<"/[lang]/proof/[code]">) {
  const { lang, code } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).proof;
  const upper = code.toUpperCase();
  const proof = PUBLIC_CODE_RE.test(upper) ? await fetchProof(upper) : null;
  if (!proof) return <section className="pt-6"><h1 className="text-3xl font-extrabold">{t.notFound}</h1></section>;

  const fileUrl = `/api/v1/public/proofs/${upper}/file`;
  const when = new Intl.DateTimeFormat(lang === "ar" ? "ar-LB" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const answer = proof.responses.at(-1);

  return (
    <section className="pt-6">
      <p className="text-sm font-semibold text-muted">{lang === "ar" ? proof.shop_name_ar : proof.shop_name_en}</p>
      <h1 className="text-3xl font-extrabold">{t.title}</h1>
      <p className="mt-1 text-muted">
        {t.forOrder} <span dir="ltr">{proof.order_number ? `#${proof.order_number}` : proof.order_code}</span> · {t.version.replace("{{n}}", String(proof.version))}
      </p>

      <div className="mt-6 border border-rule bg-tint p-2">
        {proof.kind === "pdf" ? (
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="block p-6 text-center font-bold underline">{t.openPdf}</a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a private, uncached file served by the API, not a static asset
          <img src={fileUrl} alt={t.imageAlt} className="mx-auto max-h-[70vh] w-auto" />
        )}
      </div>

      {proof.status === "superseded" && <p className="mt-6 border-s-4 border-magenta bg-tint p-3">{t.superseded}</p>}
      {proof.status === "pending" && proof.isLatest && <ProofActions code={upper} t={t} />}
      {answer && (
        <p className="mt-6 border-s-4 border-rule bg-tint p-3">
          {answer.decision === "approved" ? t.approvedOn : t.changesOn} {when.format(new Date(answer.responded_at))}
          {answer.comment && <span className="mt-1 block whitespace-pre-line text-sm">«{answer.comment}»</span>}
        </p>
      )}
      <Link href={`/${lang}/track/${proof.order_code}`} className="mt-6 inline-block text-sm font-semibold underline">{t.track}</Link>
    </section>
  );
}
