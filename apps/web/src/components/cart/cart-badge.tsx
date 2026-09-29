"use client";

import Link from "next/link";
import type { Locale } from "@mpe/shared";
import { useCart } from "@/lib/cart";
import { BagIcon } from "../ui/icons";

/** The cart link: a bag with the item count. The word itself is shown when the screen has room, and always read out. */
export function CartBadge({ lang, label }: { lang: Locale; label: string }) {
  const { count, ready } = useCart();
  return (
    <Link href={`/${lang}/cart`} className="navlink relative min-h-11 min-w-11 justify-center gap-1.5 !px-2.5">
      <BagIcon className="size-5" />
      <span className="max-[400px]:sr-only">{label}</span>
      {ready && count > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-magenta px-1 text-xs font-bold text-white">{count}</span>}
    </Link>
  );
}
