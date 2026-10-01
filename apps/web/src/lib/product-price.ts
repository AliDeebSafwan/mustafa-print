import type { PublicProduct } from "@mpe/shared";
import { unitPriceFor } from "@mpe/shared/client";
import type { Dictionary } from "@/lib/dictionaries";

/** "From 0.04 USD per sheet", "25.00 USD per piece", or nothing when the owner chose not to show prices. */
export function priceLine(p: PublicProduct, dict: Dictionary, currency: string): string | null {
  if (p.price === null) return null;
  const unit = dict.products.unit[p.unit as keyof Dictionary["products"]["unit"]] ?? p.unit;
  const amount = `${Number(p.price).toString()} ${currency}`;
  return `${p.priceIsFrom ? `${dict.products.from} ` : ""}${amount} ${dict.products.per} ${unit}`;
}

/**
 * What a quantity of a product costs, from its real pricing structure (quantity tiers apply). The one place a shopper's
 * price is worked out, shared by the product cards and the studio so the two can never disagree. It always quotes the
 * real price, even when the owner hides prices on the browse page: once someone is ordering, they need to know.
 */
export function quoteLine(product: PublicProduct, quantity: string) {
  // the API sends quantities with three decimals ("100.000"); people read and type "100"
  const min = String(Number(product.minQuantity));
  const unit = unitPriceFor({ pricing_model: product.pricingModel, base_price: product.basePrice, price_rules: product.priceRules }, quantity || "0");
  const total = (Number(unit) * Number(quantity || "0")).toFixed(2);
  const belowMin = quantity.trim() !== "" && Number(quantity) < Number(min);
  const orderable = !belowMin && quantity.trim() !== "" && Number(quantity) > 0;
  return { min, unit, total, belowMin, orderable };
}
