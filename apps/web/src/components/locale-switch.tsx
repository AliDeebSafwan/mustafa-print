"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALES } from "@mpe/shared/client";
import type { Locale } from "@mpe/shared";

/** Switches to the other language while staying on the same page. */
export function LocaleSwitch({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname() ?? `/${current}`;
  const other = LOCALES.find((l) => l !== current) ?? current;
  const href = pathname.replace(new RegExp(`^/${current}(?=/|$)`), `/${other}`);
  return (
    <Link
      href={href}
      lang={other}
      hrefLang={other}
      onClick={() => { document.cookie = `NEXT_LOCALE=${other}; path=/; max-age=31536000; samesite=lax`; }}
      className="text-sm font-semibold underline underline-offset-4 decoration-rule hover:decoration-ink"
    >
      {label}
    </Link>
  );
}
