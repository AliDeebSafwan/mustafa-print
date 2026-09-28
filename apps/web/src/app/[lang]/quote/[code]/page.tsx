import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PUBLIC_CODE_RE, isLocale } from "@mpe/shared";
import { QuoteActions } from "@/components/quote/quote-actions";
import { fetchQuote } from "@/lib/api";
import { getDictionary } from "@/lib/dictionaries";

export const metadata: Metadata = { robots: { index: false, follow: false } };   // quote links are private

export default async function QuotePage({ params }: PageProps<"/[lang]/quote/[code]">) {
  const { lang, code } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const t = dict.quote;
  const upper = code.toUpperCase();
  const quote = PUBLIC_CODE_RE.test(upper) ? await fetchQuote(upper) : null;
  if (!quote) {
    return <section className="pt-6"><h1 className="text-3xl font-extrabold">{t.notFound}</h1></section>;
  }

  const money = new Intl.NumberFormat(lang === "ar" ? "ar-LB" : "en-US", { style: "currency", currency: quote.currency });
  const date = new Intl.DateTimeFormat(lang === "ar" ? "ar-LB" : "en-GB", { dateStyle: "long" });
  const shop = lang === "ar" ? quote.shopNameAr : quote.shopNameEn;

  return (
    <section className="pt-6">
      <p className="text-sm font-semibold text-muted">{shop}</p>
      <h1 className="text-3xl font-extrabold">{t.title} #{quote.number}</h1>
      <p className="mt-1 text-muted">{t.for} {quote.customerName}</p>

      <table className="mt-6 w-full text-sm">
        <thead><tr className="border-b-2 border-ink">
          <th className="py-1.5 text-start">{t.item}</th><th className="py-1.5 text-end">{t.quantity}</th>
          <th className="py-1.5 text-end">{t.unitPrice}</th><th className="py-1.5 text-end">{t.lineTotal}</th>
        </tr></thead>
        <tbody>
          {quote.items.map((item, i) => (
            <tr key={i} className="border-b border-rule">
              <td className="py-1.5">{item.name}</td>
              <td className="py-1.5 text-end" dir="ltr">{Number(item.quantity)}</td>
              <td className="py-1.5 text-end" dir="ltr">{money.format(Number(item.unitPrice))}</td>
              <td className="py-1.5 text-end font-semibold" dir="ltr">{money.format(Number(item.lineTotal))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ms-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {Number(quote.discountTotal) > 0 && <><dt className="text-muted">{t.discount}</dt><dd className="text-end" dir="ltr">−{money.format(Number(quote.discountTotal))}</dd></>}
        {Number(quote.taxTotal) > 0 && <><dt className="text-muted">{t.tax}</dt><dd className="text-end" dir="ltr">{money.format(Number(quote.taxTotal))}</dd></>}
        <dt className="text-lg font-extrabold">{t.total}</dt><dd className="text-end text-lg font-extrabold" dir="ltr">{money.format(Number(quote.total))}</dd>
      </dl>
      {quote.notes && <p className="mt-4 whitespace-pre-line border-t border-rule pt-3 text-sm">{quote.notes}</p>}

      {quote.status === "sent" && (
        <>
          <p className="mt-6 text-sm text-muted">{t.validUntil.replace("{{date}}", date.format(new Date(quote.validUntil)))}</p>
          <QuoteActions code={upper} lang={lang} t={t} />
        </>
      )}
      {quote.status === "accepted" && quote.orderCode && (
        <p className="mt-6 border-s-4 border-rule bg-tint p-3">
          {t.alreadyAccepted} <Link className="font-semibold underline" href={`/${lang}/track/${quote.orderCode}`}>{t.track}</Link>
        </p>
      )}
      {quote.status === "expired" && <p className="mt-6 border-s-4 border-magenta bg-tint p-3">{t.expired}</p>}
      {(quote.status === "declined" || quote.status === "cancelled") && <p className="mt-6 border-s-4 border-rule bg-tint p-3">{t.closed}</p>}
    </section>
  );
}
