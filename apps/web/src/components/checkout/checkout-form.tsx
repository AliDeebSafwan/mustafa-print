"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CustomerMe, Locale, PublicProduct, WebOrderInput } from "@mpe/shared";
import { unitPriceFor } from "@mpe/shared/client";
import { SignedOut } from "@/components/account/account-area";
import { Field, Notice, primaryBtn } from "@/components/account/field";
import { account, AccountError } from "@/lib/account-client";
import { useCart } from "@/lib/cart";
import type { Dictionary } from "@/lib/dictionaries";

type Fulfillment = "pickup" | "delivery";

function errorText(t: Dictionary["checkout"], err: unknown): string {
  const code = err instanceof AccountError ? err.code : "server";
  const detail = err instanceof AccountError ? (err.detail ?? "") : "";
  if (detail.startsWith("below_minimum")) return t.error.below_minimum;
  if (detail === "product_unavailable" || detail === "file_unavailable" || detail === "infected_file" || detail === "scanner_unavailable") return t.error[detail];
  return t.error[code as keyof typeof t.error] ?? t.error.server;
}

/** Requires a verified account, then submits the cart as one order. */
export function CheckoutForm({ lang, t, accountT, totalLabel, currency, apiBase }: { lang: Locale; t: Dictionary["checkout"]; accountT: Dictionary["account"]; totalLabel: string; currency: string; apiBase: string }) {
  const router = useRouter();
  const cart = useCart();
  const [me, setMe] = useState<CustomerMe | null | undefined>(undefined);
  const [products, setProducts] = useState<PublicProduct[] | null>(null);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const requestId = useRef(crypto.randomUUID());   // stable across retries, so a resubmit never creates a second order

  useEffect(() => { account.me().then(setMe, () => setMe(null)); }, []);
  // The status check matters: an HTTP error carries a JSON body, which without it became `products` and made the
  // `byId` map below throw — a blank checkout mid-purchase. Treated like any other failure.
  useEffect(() => {
    fetch(`/api/v1/public/site/products?lang=${lang}`)
      .then((r) => { if (!r.ok) throw new Error(`products responded ${r.status}`); return r.json(); })
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [lang]);

  if (me === undefined || !products) return <p role="status" className="mt-8 text-muted">…</p>;
  if (!me) return <div className="mt-8 max-w-md"><Notice kind="info">{t.signInFirst}</Notice><div className="mt-4"><SignedOut lang={lang} t={accountT} onSignedIn={setMe} /></div></div>;
  if (!me.verified) {
    return (
      <div className="mt-8 flex max-w-md flex-col gap-3">
        <Notice kind="info">{t.notVerified}</Notice>
        <button type="button" className="self-start text-sm font-semibold underline underline-offset-4"
          onClick={() => account.resendVerification(me.email).catch(() => undefined).then(() => setResent(true))}>{t.resend}</button>
        {resent && <Notice kind="ok">{t.resent}</Notice>}
      </div>
    );
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = cart.lines.map((line) => ({ line, product: byId.get(line.productId) })).filter((r): r is { line: typeof r.line; product: PublicProduct } => Boolean(r.product));
  if (cart.ready && rows.length === 0) {
    return <div className="mt-8"><Link href={`/${lang}/cart`} className={primaryBtn}>{accountT.toAccount}</Link></div>;
  }

  const lineTotal = (product: PublicProduct, quantity: string) => Number(unitPriceFor({ pricing_model: product.pricingModel, base_price: product.basePrice, price_rules: product.priceRules }, quantity || "0")) * Number(quantity || "0");
  const subtotal = rows.reduce((sum, r) => sum + lineTotal(r.product, r.line.quantity), 0);

  async function attachFile(productId: string, file: File) {
    setUploading(productId);
    setError(null);
    try {
      const uploaded = await account.uploadDesign(file);
      cart.setFiles(productId, [{ id: uploaded.id, name: uploaded.original_name }]);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    setError(null);
    if (fulfillment === "delivery" && (!address.trim() || !city.trim())) return setError(t.needAddress);
    setBusy(true);
    const input: WebOrderInput = {
      request_id: requestId.current,
      items: rows.map((r) => ({ product_id: r.product.id, quantity: r.line.quantity, notes: r.line.notes.trim() || undefined, file_ids: r.line.files.length ? r.line.files.map((f) => f.id) : undefined })),
      fulfillment_type: fulfillment,
      ...(fulfillment === "delivery" ? { delivery_address: address.trim(), delivery_city: city.trim(), delivery_notes: deliveryNotes.trim() || undefined } : {}),
      payment_method: fulfillment === "delivery" ? "cod" : "cash",
      customer_notes: orderNotes.trim() || undefined,
    };
    try {
      const placed = await account.placeOrder(input);
      cart.clear();
      router.push(`/${lang}/track/${placed.code}`);
    } catch (err) {
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="font-display text-lg font-extrabold">{t.fulfillment}</h2>
          <div className="mt-2 flex gap-4">
            {(["pickup", "delivery"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm font-semibold">
                <input type="radio" name="fulfillment" checked={fulfillment === f} onChange={() => setFulfillment(f)} />
                {f === "pickup" ? t.pickup : t.delivery}
              </label>
            ))}
          </div>
          {fulfillment === "delivery" && (
            <div className="mt-3 flex flex-col gap-3">
              <Notice kind="info">{t.deliveryNote}</Notice>
              <Field id="address" label={t.address} required value={address} onChange={(e) => setAddress(e.target.value)} />
              <Field id="city" label={t.city} required value={city} onChange={(e) => setCity(e.target.value)} />
              <Field id="delivery-notes" label={t.deliveryNotes} value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} />
            </div>
          )}
          <p className="mt-3 text-sm text-muted">{t.payment}: <span className="font-semibold">{fulfillment === "delivery" ? t.payCod : t.payCash}</span></p>
        </div>

        <div>
          <h2 className="font-display text-lg font-extrabold">{t.attachFile}</h2>
          <ul className="mt-2 flex flex-col gap-3">
            {rows.map(({ line, product }) => (
              <li key={product.id} className="flex items-center gap-3 rounded-xl border border-rule p-2.5">
                {product.image?.srcset[0] && (
                  // eslint-disable-next-line @next/next/no-img-element -- client component: the server-only Picture helper cannot be imported here
                  <img src={`${apiBase}${product.image.srcset[0].src}`} alt={product.image.alt} width={product.image.width} height={product.image.height}
                    className="size-12 shrink-0 rounded-lg object-cover" />
                )}
                <span className="min-w-0 flex-1 truncate font-semibold">{product.name}</span>
                {line.files[0] ? (
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    {t.fileAttached.replace("{{name}}", line.files[0].name)}
                    <button type="button" className="text-magenta underline" onClick={() => cart.setFiles(product.id, [])}>{t.removeFile}</button>
                  </span>
                ) : (
                  <label className="btn btn-outline btn-sm shrink-0">
                    {uploading === product.id ? t.uploading : t.attachFile}
                    <input type="file" className="hidden" disabled={uploading === product.id}
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) void attachFile(product.id, file); }} />
                  </label>
                )}
              </li>
            ))}
          </ul>
        </div>

        <Field id="order-notes" label={t.orderNotes} value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
      </div>

      <div className="h-fit rounded-2xl bg-stock p-5">
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map(({ line, product }) => (
            <li key={product.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{product.name} × {line.quantity}</span><span dir="ltr">{lineTotal(product, line.quantity).toFixed(2)} {currency}</span></li>
          ))}
        </ul>
        <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3 font-bold"><span>{totalLabel}</span><span className="font-display text-2xl font-extrabold" dir="ltr">{subtotal.toFixed(2)} <span className="text-base">{currency}</span></span></div>
        {error && <div className="mt-3"><Notice kind="error">{error}</Notice></div>}
        <button type="button" className="btn btn-order mt-4 w-full" disabled={busy} onClick={() => void submit()}>{busy ? t.placing : t.place}</button>
      </div>
    </div>
  );
}
