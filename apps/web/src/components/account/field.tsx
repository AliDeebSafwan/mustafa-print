import type { InputHTMLAttributes } from "react";

export const inputCls = "input";
export const primaryBtn = "btn btn-ink";

/** A labelled input; help text is linked for screen readers instead of being stuffed into the label. */
export function Field({ label, help, id, ...input }: { label: string; help?: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input id={id} className={inputCls} aria-describedby={help ? `${id}-help` : undefined} {...input} />
      {help && <span id={`${id}-help`} className="text-xs text-muted">{help}</span>}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: React.ReactNode }) {
  const tone = kind === "error" ? "border-magenta" : kind === "ok" ? "border-cyan" : "border-rule";
  return <p role={kind === "error" ? "alert" : "status"} className={`border-s-4 ${tone} bg-tint p-3 text-sm font-semibold`}>{children}</p>;
}
