"use client";

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
  const min = product.minQuantity;
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
    <div className="mt-3 border-t border-rule pt-3">
      <label className="flex items-center gap-2 text-sm font-semibold">
        {t.quantity}
        <input type="text" inputMode="decimal" className="w-24 border border-ink px-2 py-1.5 text-center" dir="ltr"
          value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-describedby={`min-${product.id}`} />
      </label>
      <p id={`min-${product.id}`} className="mt-1 text-xs text-muted">{t.minimum.replace("{{n}}", min)}</p>
      {belowMin && <p role="alert" className="mt-1 text-xs font-semibold text-magenta">{t.belowMinimum.replace("{{n}}", min)}</p>}
      <p className="mt-2 text-sm font-bold" dir="auto">{lineTotal} {currency}</p>
      <button type="button" className="mt-2 w-full bg-ink px-4 py-2.5 text-sm font-bold text-paper disabled:opacity-50" disabled={belowMin || !quantity.trim()} onClick={add}>
        {added ? t.added : t.addToCart}
      </button>
    </div>
  );
}
