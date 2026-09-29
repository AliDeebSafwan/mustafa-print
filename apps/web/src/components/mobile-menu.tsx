"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@mpe/shared";
import { LocaleSwitch } from "./locale-switch";

interface Item { href: string; label: string }

/** The phone menu. Closes on any navigation and on Escape, and gives focus back to its button. */
export function MobileMenu({ lang, items, label, close, languageLabel }: { lang: Locale; items: Item[]; label: string; close: string; languageLabel: string }) {
  const pathname = usePathname();
  // Open belongs to the page it was opened on: navigating anywhere makes it read as closed, with no effect needed.
  const [opened, setOpened] = useState<string | null>(null);
  const open = opened === pathname;
  const setOpen = useCallback((next: boolean) => setOpened(next ? pathname : null), [pathname]);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <div className="lg:hidden">
      <button ref={button} type="button" aria-expanded={open} aria-controls="phone-menu" aria-label={open ? close : label} onClick={() => setOpen(!open)}
        className="btn btn-outline btn-sm !min-h-11 gap-2 max-sm:!size-11 max-sm:!p-0">
        <span aria-hidden className="relative block h-3 w-5">
          <span className={`absolute inset-x-0 h-0.5 bg-current transition-transform ${open ? "top-[5px] rotate-45" : "top-0"}`} />
          <span className={`absolute inset-x-0 h-0.5 bg-current transition-transform ${open ? "top-[5px] -rotate-45" : "top-[10px]"}`} />
        </span>
        <span aria-hidden className="max-sm:hidden">{open ? close : label}</span>
      </button>
      {open && (
        <nav id="phone-menu" aria-label={label} className="absolute inset-x-0 top-full z-30 border-b border-rule bg-paper shadow-[0_24px_40px_-24px_rgba(14,23,38,.4)]">
          <ul className="bar flex flex-col py-2">
            {items.map((i) => <li key={i.href}><Link href={i.href} className="font-display flex min-h-14 items-center border-b border-rule text-xl font-extrabold">{i.label}</Link></li>)}
            <li className="flex min-h-14 items-center"><LocaleSwitch current={lang} label={languageLabel} /></li>
          </ul>
        </nav>
      )}
    </div>
  );
}
