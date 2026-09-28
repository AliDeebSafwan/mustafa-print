import type { PublicProduct } from "@mpe/shared";
import type { Dictionary } from "@/lib/dictionaries";

/** "From 0.04 USD per sheet", "25.00 USD per piece", or nothing when the owner chose not to show prices. */
export function priceLine(p: PublicProduct, dict: Dictionary, currency: string): string | null {
  if (p.price === null) return null;
  const unit = dict.products.unit[p.unit as keyof Dictionary["products"]["unit"]] ?? p.unit;
  const amount = `${Number(p.price).toString()} ${currency}`;
  return `${p.priceIsFrom ? `${dict.products.from} ` : ""}${amount} ${dict.products.per} ${unit}`;
}
