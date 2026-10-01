"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { PublicProduct } from "@mpe/shared";
import { Counter } from "@/components/ui/counter";
import type { Dictionary } from "@/lib/dictionaries";
import type { imageAttrs } from "@/lib/site";
import { useCart } from "@/lib/cart";
import { quoteLine } from "@/lib/product-price";
import { cleanQuantity } from "@/lib/quantity";

type Img = ReturnType<typeof imageAttrs>;
export interface StudioItem { product: PublicProduct; image: Img | null }

/** A picture from attributes the server worked out (this is a client component: it cannot reach the API address). */
function Shot({ image, sizes, className }: { image: Img | null; sizes: string; className: string }) {
  if (!image?.src) return <span className={`halftone-field block ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element -- pictures are already resized by the API, as in Picture
  return <img src={image.src} srcSet={image.srcSet} width={image.width} height={image.height} alt={image.alt} sizes={sizes} className={className} loading="lazy" decoding="async" />;
}

/** Quick picks as multiples of the product's own minimum, so every one of them is a quantity it can be ordered in. */
const MULTIPLES = [1, 2, 5, 10];

/**
 * Builds one order line from the shop's real products: choose a product, set a quantity, see the real price (quantity
 * tiers included, priced by the same quoteLine as the product cards), and put it in the real cart. Nothing here is
 * illustrative: no product, picture or price on this screen is made up.
 */
export function PrintStudio({ items, currency, lang, t, cart: c }: {
  items: StudioItem[]; currency: string; lang: string; t: Dictionary["studio"]; cart: Dictionary["cart"];
}) {
  const products = items.map((i) => i.product);
  const imageOf = (id: string) => items.find((i) => i.product.id === id)?.image ?? null;
  const cart = useCart();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId) ?? products[0];
  const [quantity, setQuantityState] = useState(() => (product ? quoteLine(product, "").min : ""));
  const [added, setAdded] = useState(false);
  const minId = useId();

  if (!product) return <p className="text-muted">{t.empty}</p>;
  const line = quoteLine(product, quantity);

  const setQuantity = (raw: string) => { setQuantityState(cleanQuantity(raw)); setAdded(false); };
  const choose = (p: PublicProduct) => { setProductId(p.id); setQuantityState(quoteLine(p, "").min); setAdded(false); };
  // The stepper moves by the minimum (so it never lands below it) and never goes under it.
  const step = (dir: 1 | -1) => setQuantity(String(Math.max(Number(line.min), (Number(quantity) || 0) + dir * Math.max(1, Number(line.min)))));
  const add = () => { if (!line.orderable) return; cart.add(product.id, quantity); setAdded(true); };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="glass p-5 sm:p-7">
        <fieldset>
          <legend className="font-display text-lg font-extrabold">{t.pick}</legend>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {products.map((p) => {
              const on = p.id === product.id;
              return (
                <label key={p.id} className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border transition-[box-shadow,border-color] ${on ? "border-cyan shadow-[0_0_0_1px_var(--cyan),0_12px_32px_-14px_var(--cyan)]" : "border-rule hover:border-[var(--edge)]"}`}>
                  <input type="radio" name="studio-product" value={p.id} checked={on} onChange={() => choose(p)} className="peer sr-only" />
                  <span className="block aspect-[4/3] bg-stock">
                    <Shot image={imageOf(p.id)} sizes="(min-width: 640px) 12rem, 45vw" className="size-full object-cover" />
                  </span>
                  <span className="block p-2.5 text-sm leading-6 font-bold">{p.name}</span>
                  {/* Keyboard focus lands on the hidden radio: draw the ring on the card it stands for. */}
                  <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cyan" />
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-7">
          <label htmlFor="studio-qty" className="font-display text-lg font-extrabold">{c.quantity}</label>
          <div className="mt-3 flex items-stretch gap-2" dir="ltr">
            <button type="button" className="btn btn-outline !min-h-12 !px-4 text-xl" onClick={() => step(-1)} aria-label={t.decrease} disabled={Number(quantity) <= Number(line.min)}>−</button>
            <input id="studio-qty" type="text" inputMode="decimal" className="input !min-h-12 flex-1 text-center !text-lg font-bold" value={quantity}
              onChange={(e) => setQuantity(e.target.value)} aria-describedby={minId} />
            <button type="button" className="btn btn-outline !min-h-12 !px-4 text-xl" onClick={() => step(1)} aria-label={t.increase}>+</button>
          </div>
          <p id={minId} className={`mt-2 text-sm ${line.belowMin ? "font-semibold text-magenta" : "text-muted"}`} role={line.belowMin ? "alert" : undefined}>
            {(line.belowMin ? c.belowMinimum : c.minimum).replace("{{n}}", line.min)}
          </p>
          <p className="mt-4 text-sm font-semibold text-muted">{t.quick}</p>
          <div className="mt-2 flex flex-wrap gap-2" dir="ltr">
            {MULTIPLES.map((m) => {
              const q = String(Number(line.min) * m);
              return (
                <button key={m} type="button" onClick={() => setQuantity(q)} aria-pressed={quantity === q}
                  className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${quantity === q ? "border-cyan bg-cyan/10 text-cyan" : "border-rule hover:border-[var(--edge)]"}`}>{q}</button>
              );
            })}
          </div>
        </div>

        {/* On a phone the readout below is a long scroll away from the quantity: the live total and the button ride
            along the bottom of the screen while this panel is in view. Wide screens keep the readout beside it. */}
        <div className="sticky bottom-0 z-10 -mx-5 mt-6 -mb-5 flex items-center justify-between gap-3 border-t border-[var(--edge)] bg-paper/90 px-5 py-3 backdrop-blur-md sm:-mx-7 sm:-mb-7 sm:px-7 lg:hidden">
          <p className="min-w-0">
            <span className="block text-xs font-semibold text-muted">{t.total}</span>
            <span className="font-display t-glow block w-fit text-xl font-extrabold" dir="ltr"><Counter value={Number(line.total)} live={false} /> <span className="text-sm">{currency}</span></span>
          </p>
          <button type="button" className="btn btn-order btn-sm shrink-0" disabled={!line.orderable} onClick={add}>{added ? c.added : c.addToCart}</button>
        </div>
      </div>

      {/* The readout: the chosen product, the quantity, and what it costs, live. */}
      <div className="glass relative overflow-hidden p-5 sm:p-7 lg:sticky lg:top-6 lg:self-start">
        <p className="font-display text-lg font-extrabold">{t.preview}</p>
        <div className="relative mt-4 overflow-hidden rounded-2xl bg-stock shadow-[0_0_0_1px_var(--edge),0_24px_50px_-24px_rgb(0_242_254/.5)]">
          <Shot image={imageOf(product.id)} sizes="(min-width: 1024px) 28rem, 90vw" className="aspect-[4/3] w-full object-cover" />
          <span className="font-display absolute end-3 top-3 rounded-full bg-paper/80 px-3 py-1 text-sm font-extrabold backdrop-blur" dir="ltr">× {quantity || "0"}</span>
        </div>
        <p className="font-display mt-4 text-xl leading-snug font-extrabold">{product.name}</p>
        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-rule p-3">
            <dt className="text-xs font-semibold text-muted">{t.unitPrice}</dt>
            <dd className="font-display mt-1 text-lg font-extrabold" dir="ltr"><Counter value={Number(line.unit)} decimals={Number(line.unit) < 1 ? 3 : 2} /> <span className="text-sm">{currency}</span></dd>
          </div>
          <div className="rounded-2xl border border-[var(--edge)] bg-cyan/5 p-3">
            <dt className="text-xs font-semibold text-muted">{t.total}</dt>
            <dd className="font-display t-glow mt-1 w-fit text-2xl font-extrabold" dir="ltr"><Counter value={Number(line.total)} /> <span className="text-base">{currency}</span></dd>
          </div>
        </dl>
        <button type="button" className="btn btn-order mt-5 w-full" disabled={!line.orderable} onClick={add}>{added ? c.added : c.addToCart}</button>
        {added && <Link href={`/${lang}/cart`} className="mt-3 block text-center text-sm font-bold underline underline-offset-4">{c.viewCart}</Link>}
      </div>
    </div>
  );
}
