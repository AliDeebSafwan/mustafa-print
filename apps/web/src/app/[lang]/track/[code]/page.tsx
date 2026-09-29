import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ORDER_STATUS_LABELS, PUBLIC_CODE_RE, isLocale, isOrderStatus, type Locale } from "@mpe/shared";
import { getDictionary } from "@/lib/dictionaries";
import { fetchTrackedOrder } from "@/lib/api";
import { dateLocale, formatMoney } from "@/lib/format";

export const metadata: Metadata = { robots: { index: false, follow: false } };  // tracking links are private

/** Customer-facing stage of an internal status (design/approval count as "received", finishing as "printing"). */
function stageOf(status: string): number {
  switch (status) {
    case "printing": case "finishing": return 1;
    case "ready": case "out_for_delivery": return 2;
    case "delivered": return 3;
    default: return 0;
  }
}

const label = (status: string, lang: Locale) => (isOrderStatus(status) ? ORDER_STATUS_LABELS[status][lang] : status);

export default async function TrackPage({ params }: PageProps<"/[lang]/track/[code]">) {
  const { lang, code } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const upper = code.toUpperCase();
  const data = PUBLIC_CODE_RE.test(upper) ? await fetchTrackedOrder(upper) : null;

  if (!data) {
    return (
      <section className="py-16">
        <h1 className="text-3xl font-extrabold">{dict.order.notFound.title}</h1>
        <p className="mt-3 text-lg text-muted">{dict.order.notFound.text}</p>
        <Link href={`/${lang}#track`} className="btn btn-ink mt-8">{dict.order.back}</Link>
      </section>
    );
  }

  const { order, timeline, items } = data;
  const when = new Intl.DateTimeFormat(dateLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  const money = { format: (v: number) => formatMoney(v, order.currency, lang) };
  const cancelled = order.status === "cancelled";
  const stage = stageOf(order.status);

  return (
    <article className="py-12">
      <p className="text-sm font-semibold text-muted">{dict.order.title}</p>
      <h1 className="mt-1 text-4xl font-extrabold sm:text-5xl"><span dir="ltr">#{order.order_number ?? "…"}</span></h1>

      <div className="mt-8 border-y border-rule py-6">
        <p className="text-sm font-semibold text-muted">{dict.order.status}</p>
        <p className="mt-1 text-2xl font-extrabold">{label(order.status, lang)}</p>
        {!cancelled && (
          <ol className="mt-6 grid grid-cols-4 gap-2" aria-label={dict.order.timeline}>
            {dict.order.stages.map((name, i) => (
              <li key={name} aria-current={i === stage ? "step" : undefined}>
                <div className={`h-1.5 ${i <= stage ? "bg-magenta" : "bg-rule"}`} />
                <p className={`mt-2 text-sm ${i <= stage ? "font-bold" : "text-muted"}`}>{name}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-10 grid gap-12 sm:grid-cols-2">
        <section>
          <h2 className="text-xl font-extrabold">{dict.order.timeline}</h2>
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {[...timeline].reverse().map((t, i) => (
              <li key={`${t.status}-${t.occurred_at}`} className="flex items-baseline justify-between gap-4 py-3">
                <span className={i === 0 ? "font-bold" : ""}>{label(t.status, lang)}</span>
                <time dateTime={t.occurred_at} className="text-sm text-muted">{when.format(new Date(t.occurred_at))}</time>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-extrabold">{dict.order.items}</h2>
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {items.map((it, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-3">
                <span>{it.name}</span>
                <span dir="ltr" className="text-sm text-muted">× {Number(it.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-6 space-y-2">
            <div className="flex justify-between"><dt className="text-muted">{order.delivery_fee_pending ? dict.order.totalPending : dict.order.total}</dt><dd className="font-bold" dir="ltr">{money.format(Number(order.total))}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">{dict.order.payment[order.payment_status]}</dt><dd>{dict.order.fulfillment[order.fulfillment_type]}</dd></div>
          </dl>
          {order.delivery_fee_pending && <p className="mt-4 border-s-4 border-rule bg-tint p-3 text-sm">{dict.order.deliveryFeePending}</p>}
        </section>
      </div>
    </article>
  );
}
