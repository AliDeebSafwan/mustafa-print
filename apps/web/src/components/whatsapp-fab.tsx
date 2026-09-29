"use client";

import { usePathname } from "next/navigation";
import { WhatsAppIcon } from "./icons";

/** Where the shop takes questions in Lebanon. Hidden where it would cover what the page is for: the cart and checkout,
 *  the account, a proof or quote being answered, and the product list (whose totals sit where the button would, and
 *  where every product already has its own WhatsApp question link). */
const QUIET = /\/(cart|checkout|account|proof|quote|products)(\/|$)/;

export function WhatsAppFab({ href, label }: { href: string; label: string }) {
  const pathname = usePathname() ?? "";
  if (QUIET.test(pathname)) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
      className="fixed bottom-5 end-5 z-20 grid size-14 place-items-center rounded-full bg-whatsapp text-white shadow-[0_10px_24px_-6px_rgba(0,0,0,.45)] transition-transform hover:scale-105 sm:hidden">
      <WhatsAppIcon className="size-7" />
    </a>
  );
}
