"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PUBLIC_CODE_RE } from "@mpe/shared/client";
import type { Locale } from "@mpe/shared";

interface Props {
  lang: Locale;
  labels: { label: string; hint: string; placeholder: string; submit: string; invalid: string };
  initial?: string;
}

export function TrackForm({ lang, labels, initial = "" }: Props) {
  const router = useRouter();
  const [code, setCode] = useState(initial);
  const [invalid, setInvalid] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/[\s-]/g, "");
    if (!PUBLIC_CODE_RE.test(clean)) return setInvalid(true);
    setInvalid(false);
    router.push(`/${lang}/track/${clean}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <label htmlFor="track-code" className="block text-lg font-bold">{labels.label}</label>
      <p id="track-hint" className="mt-1 text-sm text-muted">{labels.hint}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          id="track-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          dir="ltr"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          placeholder={labels.placeholder}
          aria-describedby="track-hint track-error"
          aria-invalid={invalid}
          className="input flex-1 !text-lg font-mono tracking-widest uppercase placeholder:text-muted/60 placeholder:normal-case placeholder:tracking-normal"
        />
        <button type="submit" className="btn btn-order sm:min-w-36">
          {labels.submit}
        </button>
      </div>
      <p id="track-error" role="alert" className="mt-2 min-h-6 text-sm font-semibold text-magenta">{invalid ? labels.invalid : ""}</p>
    </form>
  );
}
