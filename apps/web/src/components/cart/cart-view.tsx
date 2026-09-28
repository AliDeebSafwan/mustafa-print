"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { unitPriceFor } from "@mpe/shared/client";
import type { Locale, PublicProduct } from "@mpe/shared";
import { useCart } from "@/lib/cart";
import { cleanQuantity } from "@/lib/quantity";
import type { Dictionary } from "@/lib/dictionaries";

/**
 * The cart's contents. The cart itself only remembers product ids and quantities, so this fetches the live
 * catalogue to show names, pictures and current prices — and drops any line whose product disappeared.
 */
export function CartView({ lang, t, checkoutLabel, apiBase }: { lang: Locale; t: Dictionary["cart"]; checkoutLabel: string; apiBase: string }) {
  const cart = useCart();
  const [products, setProducts] = useState<PublicProduct[] | null>(null);

  useEffect(() => {
    fetch(`/api/v1/public/site/products?lang=${lang}`).then((r) => r.json()).then(setProducts).catch(() => setProducts([]));
  }, [lang]);

  // Derived during render, not stored: whether any cart line points at a product that no longer exists.
  const missingIds = products && cart.ready ? cart.lines.filter((l) => !products.some((p) => p.id === l.productId)).map((l) => l.productId) : [];
  const droppedAny = missingIds.length > 0;

  useEffect(() => {
    if (missingIds.length === 0) return;
    // Deferred into a microtask so this reads as "reacting to a change," not a synchronous render-time setState.
    Promise.resolve().then(() => { missingIds.forEach((id) => cart.remove(id)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the ids themselves, not the cart/remove identity
  }, [missingIds.join(",")]);

  if (!cart.ready || !products) return <p role="status" className="mt-8 text-muted">…</p>;
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = cart.lines.map((line) => ({ line, product: byId.get(line.productId) })).filter((r): r is { line: typeof r.line; product: PublicProduct } => Boolean(r.product));

  if (rows.length === 0) {
    return (
      <div className="mt-8">
        {droppedAny && <p role="alert" className="mb-4 border-s-4 border-magenta bg-tint p-3 text-sm">{t.unavailable}</p>}
        <p className="text-muted">{t.empty}</p>
        <Link href={`/${lang}/products`} className="mt-4 inline-block bg-ink px-5 py-3 font-bold text-paper">{t.browse}</Link>
      </div>
    );
  }

  const lineTotal = (product: PublicProduct, quantity: string) => Number(unitPriceFor({ pricing_model: product.pricingModel, base_price: product.basePrice, price_rules: product.priceRules }, quantity || "0")) * Number(quantity || "0");
  const subtotal = rows.reduce((sum, r) => sum + lineTotal(r.product, r.line.quantity), 0);

  return (
    <div className="mt-8">
      {droppedAny && <p role="alert" className="mb-4 border-s-4 border-magenta bg-tint p-3 text-sm">{t.unavailable}</p>}
      <ul className="divide-y divide-rule border-y border-rule">
        {rows.map(({ line, product }) => {
          const belowMin = Number(line.quantity) < Number(product.minQuantity);
          return (
            <li key={product.id} className="flex flex-col gap-3 py-4 sm:flex-row">
              {product.image?.srcset[0] && (
                // eslint-disable-next-line @next/next/no-img-element -- client component: the server-only Picture helper cannot be imported here
                <img src={`${apiBase}${product.image.srcset[0].src}`} alt={product.image.alt} width={product.image.width} height={product.image.height}
                  className="size-24 shrink-0 bg-tint object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-bold">{product.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    {t.quantity}
                    <input type="text" inputMode="decimal" dir="ltr" className="w-20 border border-ink px-2 py-1.5 text-center"
                      value={line.quantity} onChange={(e) => cart.setQuantity(product.id, cleanQuantity(e.target.value))} />
                  </label>
                  <button type="button" className="text-sm font-semibold text-magenta underline underline-offset-4" onClick={() => cart.remove(product.id)}>{t.remove}</button>
                </div>
                {belowMin && <p role="alert" className="mt-1 text-xs font-semibold text-magenta">{t.belowMinimum.replace("{{n}}", product.minQuantity)}</p>}
                <input type="text" className="mt-2 w-full border border-rule px-2 py-1.5 text-sm" placeholder={t.notes}
                  value={line.notes} onChange={(e) => cart.setNotes(product.id, e.target.value)} />
              </div>
              <p className="shrink-0 self-start font-bold sm:self-center" dir="ltr">{lineTotal(product, line.quantity).toFixed(2)}</p>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex items-center justify-between">
        <span className="text-lg font-bold">{t.subtotal}</span>
        <span className="text-lg font-extrabold" dir="ltr">{subtotal.toFixed(2)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{t.subtotalNote}</p>
      <Link href={`/${lang}/checkout`} className="mt-4 block w-full bg-ink px-5 py-3 text-center font-bold text-paper sm:inline-block sm:w-auto">{checkoutLabel}</Link>
    </div>
  );
}
