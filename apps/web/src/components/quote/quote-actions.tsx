"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Locale } from "@mpe/shared";
import type { Dictionary } from "@/lib/dictionaries";

/** Accept or decline the quote. Same-origin calls through the website's own /api rewrite; the code is the only credential. */
export function QuoteActions({ code, lang, t }: { code: string; lang: Locale; t: Dictionary["quote"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/quotes/${code}/accept`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { orderCode } = (await res.json()) as { orderCode: string };
      router.push(`/${lang}/track/${orderCode}`);
    } catch {
      setError(t.error);
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/quotes/${code}/decline`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDeclined(true);
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  }

  if (declined) return <p role="status" className="mt-6 border-s-4 border-rule bg-tint p-3">{t.declinedThanks}</p>;

  return (
    <div className="mt-6 flex flex-col gap-3 print:hidden">
      {error && <p role="alert" className="font-semibold text-magenta">{error}</p>}
      <button type="button" className="bg-ink px-5 py-3 font-bold text-paper disabled:opacity-50" disabled={busy} onClick={() => void accept()}>
        {busy && !declining ? t.accepting : t.accept}
      </button>
      {!declining ? (
        <button type="button" className="self-start text-sm font-semibold underline underline-offset-4" onClick={() => setDeclining(true)}>{t.decline}</button>
      ) : (
        <div className="flex flex-col gap-2 border border-rule p-3">
          <label className="text-sm font-semibold" htmlFor="decline-reason">{t.declineReason}</label>
          <textarea id="decline-reason" className="border border-ink px-3 py-2" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          <button type="button" className="self-start border border-ink px-4 py-2 font-semibold disabled:opacity-50" disabled={busy} onClick={() => void decline()}>{t.confirmDecline}</button>
        </div>
      )}
    </div>
  );
}
