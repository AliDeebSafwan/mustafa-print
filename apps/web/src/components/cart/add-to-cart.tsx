"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { unitPriceFor } from "@mpe/shared/client";
import type { PublicProduct } from "@mpe/shared";
import { useCart } from "@/lib/cart";
import { cleanQuantity } from "@/lib/quantity";
import type { Dictionary } from "@/lib/dictionaries";

/**
 * Lets a shopper pick a quantity and add a product to the cart, with a live per-unit price as they type (quantity
 * tiers apply automatically). This always quotes the real price, even when the owner set price_display to "hidden"
 * on the browse page: once someone is actually ordering, they need to know what they will pay.
 */
export function AddToCart({ product, currency, t }: { product: PublicProduct; currency: string; t: Dictionary["cart"] }) {
  const cart = useCart();
  const lang = String(useParams<{ lang: string }>()?.lang ?? "ar");
  // the API sends quantities with three decimals ("100.000"); people read and type "100"
  const min = String(Number(product.minQuantity));
  const [quantity, setQuantityState] = useState(min);
  const [added, setAdded] = useState(false);

  const unit = unitPriceFor({ pricing_model: product.pricingModel, base_price: product.basePrice, price_rules: product.priceRules }, quantity || "0");
  const lineTotal = (Number(unit) * Number(quantity || "0")).toFixed(2);
  const belowMin = quantity.trim() !== "" && Number(quantity) < Number(min);

  function setQuantity(raw: string) {
    setQuantityState(cleanQuantity(raw));
    setAdded(false);
  }

  function add() {
    if (belowMin || !quantity.trim() || Number(quantity) <= 0) return;
    cart.add(product.id, quantity);
    setAdded(true);
  }

  return (
    <div className="mt-4 rounded-xl bg-stock p-3.5">
      <div className="flex items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          {t.quantity}
          <input type="text" inputMode="decimal" className="input !min-h-11 !w-28 text-center !text-base font-bold text-ink" dir="ltr"
            value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-describedby={`min-${product.id}`} />
        </label>
        <p className="text-end" aria-live="polite">
          <span className="block text-xs font-semibold text-muted">{t.subtotal}</span>
          <span className="font-display text-2xl leading-tight font-extrabold" dir="ltr">{lineTotal} <span className="text-base">{currency}</span></span>
        </p>
      </div>
      <p id={`min-${product.id}`} className={`mt-1.5 text-xs ${belowMin ? "font-semibold text-magenta" : "text-muted"}`} role={belowMin ? "alert" : undefined}>
        {(belowMin ? t.belowMinimum : t.minimum).replace("{{n}}", min)}
      </p>
      <button type="button" className="btn btn-order mt-3 w-full" disabled={belowMin || !quantity.trim()} onClick={add}>
        {added ? t.added : t.addToCart}
      </button>
      {added && <Link href={`/${lang}/cart`} className="mt-2 block text-center text-sm font-bold underline underline-offset-4">{t.viewCart}</Link>}
    </div>
  );
}
