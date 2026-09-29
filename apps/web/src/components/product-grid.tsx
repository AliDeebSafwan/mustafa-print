import type { PublicProduct } from "@mpe/shared";
import { AddToCart } from "@/components/cart/add-to-cart";
import { Picture } from "@/components/picture";
import type { Dictionary } from "@/lib/dictionaries";
import { fill } from "@/lib/i18n";
import { priceLine } from "@/lib/product-price";
import { whatsappLink } from "@/lib/site";

/** A grid of orderable products, each with its picture, price (per the owner's chosen display), a WhatsApp inquiry
 *  link, and the quantity-and-add-to-cart control. Used both by the full catalogue and a service's own page. */
/** `heading` follows the page outline: h2 when the grid sits right under the page title, h3 under a section heading. */
export function ProductGrid({ products, dict, currency, whatsapp, heading = "h3", priorityFirst = false }: { products: PublicProduct[]; dict: Dictionary; currency: string; whatsapp: string | null; heading?: "h2" | "h3"; /** The first picture is the first thing on screen: fetch it at once, not lazily. */ priorityFirst?: boolean }) {
  const Title = heading;
  return (
    <ul className="grid gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
      {products.map((p, index) => {
        const price = priceLine(p, dict, currency);
        return (
          <li key={p.sku} className="chip">
            {p.image && (
              <div className="chip-art aspect-[16/10] sm:aspect-[4/3]">
                <Picture image={p.image} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="size-full" priority={priorityFirst && index === 0} />
              </div>
            )}
            <div className="chip-label flex flex-1 flex-col !p-5">
              <Title className="font-display text-xl leading-snug font-extrabold">{p.name}</Title>
              {p.description && <p className="mt-1 leading-7 text-muted">{p.description}</p>}
              <div className="mt-auto pt-5">
                {price && <p className="font-display text-lg font-extrabold" dir="auto">{price}</p>}
                {whatsapp && (
                  <a className="mt-1 inline-block text-sm font-semibold underline underline-offset-4" target="_blank" rel="noopener noreferrer"
                    href={whatsappLink(whatsapp, fill(dict.products.askMessage, { name: p.name }))}>{dict.products.quote}</a>
                )}
                <AddToCart product={p} currency={currency} t={dict.cart} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
