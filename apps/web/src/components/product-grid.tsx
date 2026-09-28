import type { PublicProduct } from "@mpe/shared";
import { AddToCart } from "@/components/cart/add-to-cart";
import { Picture } from "@/components/picture";
import type { Dictionary } from "@/lib/dictionaries";
import { fill } from "@/lib/i18n";
import { priceLine } from "@/lib/product-price";
import { whatsappLink } from "@/lib/site";

/** A grid of orderable products, each with its picture, price (per the owner's chosen display), a WhatsApp inquiry
 *  link, and the quantity-and-add-to-cart control. Used both by the full catalogue and a service's own page. */
export function ProductGrid({ products, dict, currency, whatsapp }: { products: PublicProduct[]; dict: Dictionary; currency: string; whatsapp: string | null }) {
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => {
        const price = priceLine(p, dict, currency);
        return (
          <li key={p.sku} className="flex flex-col border border-rule p-4">
            {p.image && <Picture image={p.image} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="aspect-[4/3] w-full bg-tint object-cover" />}
            <h3 className="mt-3 text-lg font-bold">{p.name}</h3>
            {p.description && <p className="mt-1 leading-7 text-muted">{p.description}</p>}
            <div className="mt-auto pt-4">
              {price && <p className="font-bold" dir="auto">{price}</p>}
              {whatsapp && (
                <a className="mt-2 inline-block text-sm font-semibold underline underline-offset-4" target="_blank" rel="noopener noreferrer"
                  href={whatsappLink(whatsapp, fill(dict.products.askMessage, { name: p.name }))}>{dict.products.quote}</a>
              )}
              <AddToCart product={p} currency={currency} t={dict.cart} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
