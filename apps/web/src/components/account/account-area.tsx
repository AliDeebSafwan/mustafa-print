"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { normalizePhone, PASSWORD_MIN } from "@mpe/shared/client";
import type { CustomerMe, CustomerOrderSummary, Locale } from "@mpe/shared";
import { account, AccountError } from "@/lib/account-client";
import { useCart } from "@/lib/cart";
import type { Dictionary } from "@/lib/dictionaries";
import { Field, Notice, primaryBtn } from "./field";

type T = Dictionary["account"];
const messageFor = (t: T, err: unknown) => t.error[(err instanceof AccountError ? err.code : "server") as keyof T["error"]];

/** Signed in: the customer's orders. Signed out: sign in, or open an account. */
export function AccountArea({ lang, t, statusLabels }: { lang: Locale; t: T; statusLabels: Record<string, string> }) {
  const [me, setMe] = useState<CustomerMe | null | undefined>(undefined);
  useEffect(() => { account.me().then(setMe, () => setMe(null)); }, []);

  // The space is held while the page asks whether the visitor is signed in, so the footer does not jump when the
  // form (or the order list) appears a moment later.
  return (
    <div className="min-h-[36rem]">
      {me === undefined ? <p role="status" className="text-muted">{t.working}</p>
        : !me ? <SignedOut lang={lang} t={t} onSignedIn={setMe} />
        : <SignedIn lang={lang} t={t} me={me} statusLabels={statusLabels} onSignedOut={() => setMe(null)} />}
    </div>
  );
}

export function SignedOut({ lang, t, onSignedIn }: { lang: Locale; t: T; onSignedIn: (me: CustomerMe) => void }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
    if (mode === "up" && form.phone.trim() && !phone) return setError(t.badPhone);
    setBusy(true);
    try {
      if (mode === "in") onSignedIn(await account.login(form.email, form.password));
      else { await account.signup({ email: form.email, password: form.password, full_name: form.name, phone_e164: phone, locale: lang }); setSent(true); }
    } catch (err) {
      setError(messageFor(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <Notice kind="ok">{t.checkEmail}</Notice>;
  const tab = (active: boolean) => `font-display min-h-11 rounded-full text-center font-extrabold transition-colors ${active ? "bg-ink text-paper" : "hover:bg-white"}`;
  return (
    <div className="max-w-md">
      <div className="grid grid-cols-2 gap-1 rounded-full bg-stock p-1" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "in"} className={tab(mode === "in")} onClick={() => { setMode("in"); setError(null); }}>{t.signIn}</button>
        <button type="button" role="tab" aria-selected={mode === "up"} className={tab(mode === "up")} onClick={() => { setMode("up"); setError(null); }}>{t.signUp}</button>
      </div>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        {mode === "up" && <Field id="name" label={t.name} autoComplete="name" required value={form.name} onChange={set("name")} />}
        <Field id="email" label={t.email} type="email" dir="ltr" autoComplete="email" required value={form.email} onChange={set("email")} />
        <Field id="password" label={t.password} type="password" dir="ltr" required minLength={mode === "up" ? PASSWORD_MIN : undefined}
          autoComplete={mode === "in" ? "current-password" : "new-password"} help={mode === "up" ? t.passwordHelp : undefined} value={form.password} onChange={set("password")} />
        {mode === "up" && <Field id="phone" label={t.phone} type="tel" dir="ltr" autoComplete="tel" value={form.phone} onChange={set("phone")} />}
        {error && <Notice kind="error">{error}</Notice>}
        {mode === "up" && (
          <p className="text-sm text-muted">
            {t.agree} <a className="underline underline-offset-4" href={`/${lang}/terms`} target="_blank" rel="noopener">{t.terms}</a> {t.and}{" "}
            <a className="underline underline-offset-4" href={`/${lang}/privacy`} target="_blank" rel="noopener">{t.privacy}</a>.
          </p>
        )}
        <button type="submit" className={primaryBtn} disabled={busy}>{busy ? t.working : mode === "in" ? t.submitIn : t.submitUp}</button>
        {mode === "in" && <Link href={`/${lang}/account/forgot`} className="text-sm font-semibold underline underline-offset-4">{t.forgot}</Link>}
      </form>
    </div>
  );
}

function SignedIn({ lang, t, me, statusLabels, onSignedOut }: { lang: Locale; t: T; me: CustomerMe; statusLabels: Record<string, string>; onSignedOut: () => void }) {
  const router = useRouter();
  const cart = useCart();
  const [orders, setOrders] = useState<CustomerOrderSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);
  const [reorderedSome, setReorderedSome] = useState(false);
  useEffect(() => { account.orders().then(setOrders, () => setOrders([])); }, []);

  async function resend() { await account.resendVerification(me.email).catch(() => undefined); setNotice(t.resent); }
  async function signOut() { await account.logout().catch(() => undefined); onSignedOut(); }

  async function reorder(code: string) {
    setReordering(code);
    setNotice(null);
    setReorderedSome(false);
    try {
      const items = await account.reorderItems(code);
      const available = items.filter((i) => i.available);
      for (const item of available) cart.add(item.productId, item.quantity);
      if (available.length === 0) { setNotice(t.reorderNoneAvailable); return; }
      if (available.length < items.length) {
        setNotice(t.reorderPartial.replace("{{added}}", String(available.length)).replace("{{skipped}}", String(items.length - available.length)));
        setReorderedSome(true);
        return;
      }
      router.push(`/${lang}/cart`);
    } catch {
      setNotice(t.reorderFailed);
    } finally {
      setReordering(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p><span className="font-bold">{me.fullName}</span> <span className="text-muted" dir="ltr">{me.email}</span></p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void signOut()}>{t.signOut}</button>
      </div>
      {!me.verified && (
        <div className="mt-4 flex flex-col gap-2">
          <Notice kind="info">{t.notVerified}</Notice>
          <button type="button" className="self-start text-sm font-semibold underline underline-offset-4" onClick={() => void resend()}>{t.resend}</button>
          {notice && <Notice kind="ok">{notice}</Notice>}
        </div>
      )}
      <h2 className="mt-8 text-2xl font-extrabold">{t.orders}</h2>
      {notice && me.verified && <Notice kind="info">{notice} {reorderedSome && <Link href={`/${lang}/cart`} className="underline underline-offset-4">{t.viewCart}</Link>}</Notice>}
      {orders === null ? <p role="status" className="mt-3 text-muted">{t.working}</p> : orders.length === 0 ? <p className="mt-3 text-muted">{t.noOrders}</p> : (
        <ul className="mt-4 divide-y divide-rule border-y border-rule">
          {orders.map((o) => (
            <li key={o.code} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-bold">{t.orderNo} <span dir="ltr">{o.number ? `#${o.number}` : o.code}</span></p>
                <p className="text-sm text-muted">{statusLabels[o.status] ?? o.status} · <span dir="ltr">{Number(o.total).toFixed(2)} {o.currency}</span></p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className="btn btn-outline btn-sm" disabled={reordering !== null} onClick={() => void reorder(o.code)}>
                  {reordering === o.code ? t.working : t.reorder}
                </button>
                <Link href={`/${lang}/track/${o.code}`} className="btn btn-outline btn-sm">{t.track}</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
