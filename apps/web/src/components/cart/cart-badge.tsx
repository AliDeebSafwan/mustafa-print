"use client";

import Link from "next/link";
import type { Locale } from "@mpe/shared";
import { useCart } from "@/lib/cart";

export function CartBadge({ lang, label }: { lang: Locale; label: string }) {
  const { count, ready } = useCart();
  return (
    <Link href={`/${lang}/cart`} className="relative text-sm font-semibold underline-offset-4 hover:underline">
      {label}
      {ready && count > 0 && <span className="ms-1 inline-flex size-5 items-center justify-center rounded-full bg-magenta text-xs font-bold text-white">{count}</span>}
    </Link>
  );
}
