"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PASSWORD_MIN } from "@mpe/shared/client";
import type { Locale } from "@mpe/shared";
import { account, AccountError } from "@/lib/account-client";
import type { Dictionary } from "@/lib/dictionaries";
import { Field, Notice, primaryBtn } from "./field";

type T = Dictionary["account"];
const messageFor = (t: T, err: unknown) => t.error[(err instanceof AccountError ? err.code : "server") as keyof T["error"]];
const tokenFromUrl = () => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "");

/** Opened from the confirmation email: confirms once, then signs the customer in. */
export function VerifyScreen({ lang, t }: { lang: Locale; t: T }) {
  const [state, setState] = useState<{ kind: "working" | "ok" | "error"; text: string }>({ kind: "working", text: t.verifying });
  const started = useRef(false);   // development renders effects twice; a one-time link must be sent once
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    account.verify(tokenFromUrl()).then(() => setState({ kind: "ok", text: t.verified }), (err) => setState({ kind: "error", text: messageFor(t, err) }));
  }, [t]);
  return (
    <div className="flex max-w-md flex-col gap-4">
      {state.kind === "working" ? <p role="status" className="text-muted">{state.text}</p> : <Notice kind={state.kind}>{state.text}</Notice>}
      {state.kind === "ok" && <Link href={`/${lang}/account`} className={`${primaryBtn} self-start`}>{t.toAccount}</Link>}
    </div>
  );
}

export function ForgotScreen({ t }: { t: T }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try { await account.forgot(email); setResult({ kind: "ok", text: t.checkEmail }); } catch (err) { setResult({ kind: "error", text: messageFor(t, err) }); } finally { setBusy(false); }
  }
  if (result?.kind === "ok") return <Notice kind="ok">{result.text}</Notice>;
  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <p className="text-muted">{t.forgotHelp}</p>
      <Field id="email" label={t.email} type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      {result && <Notice kind="error">{result.text}</Notice>}
      <button type="submit" className={primaryBtn} disabled={busy}>{busy ? t.working : t.send}</button>
    </form>
  );
}

export function ResetScreen({ lang, t }: { lang: Locale; t: T }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try { await account.reset(tokenFromUrl(), password); setResult({ kind: "ok", text: t.resetDone }); } catch (err) { setResult({ kind: "error", text: messageFor(t, err) }); } finally { setBusy(false); }
  }
  if (result?.kind === "ok") {
    return <div className="flex max-w-md flex-col gap-4"><Notice kind="ok">{result.text}</Notice><Link href={`/${lang}/account`} className={`${primaryBtn} self-start`}>{t.toAccount}</Link></div>;
  }
  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <Field id="password" label={t.newPassword} type="password" dir="ltr" autoComplete="new-password" required minLength={PASSWORD_MIN} help={t.passwordHelp}
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {result && <Notice kind="error">{result.text}</Notice>}
      <button type="submit" className={primaryBtn} disabled={busy}>{busy ? t.working : t.save}</button>
    </form>
  );
}
