"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Dictionary } from "@/lib/dictionaries";

/** Approve the proof, or ask for changes with a comment. One answer per version; the shop keeps it on record. */
export function ProofActions({ code, t }: { code: string; t: Dictionary["proof"] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "changes">("choose");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(decision: "approved" | "changes_requested") {
    if (decision === "changes_requested" && !comment.trim()) return setError(t.commentRequired);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/proofs/${code}/respond`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();                  // the page re-reads the proof and shows the recorded answer
    } catch {
      setError(t.error);
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {error && <p role="alert" className="font-semibold text-magenta">{error}</p>}
      {mode === "choose" ? (
        <>
          <p className="text-sm text-muted">{t.approveNote}</p>
          <button type="button" className="bg-ink px-5 py-3 font-bold text-paper disabled:opacity-50" disabled={busy} onClick={() => void send("approved")}>{t.approve}</button>
          <button type="button" className="border border-ink px-5 py-3 font-semibold" onClick={() => setMode("changes")}>{t.requestChanges}</button>
        </>
      ) : (
        <div className="flex flex-col gap-2 border border-rule p-3">
          <label className="text-sm font-semibold" htmlFor="proof-comment">{t.whatToChange}</label>
          <textarea id="proof-comment" className="border border-ink px-3 py-2" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
          <div className="flex gap-2">
            <button type="button" className="bg-ink px-4 py-2 font-bold text-paper disabled:opacity-50" disabled={busy} onClick={() => void send("changes_requested")}>{t.sendChanges}</button>
            <button type="button" className="border border-ink px-4 py-2 font-semibold" onClick={() => { setMode("choose"); setError(null) }}>{t.back}</button>
          </div>
        </div>
      )}
    </div>
  );
}
