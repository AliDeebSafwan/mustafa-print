import Link from "next/link";
import type { Locale } from "@mpe/shared";
import type { Dictionary } from "@/lib/dictionaries";
import { CartBadge } from "./cart/cart-badge";
import { LocaleSwitch } from "./locale-switch";

const LINKS = ["services", "gallery", "products", "contact"] as const;

/** The top of every page. On phones the links wrap onto a second row rather than hiding behind a menu button. */
export function SiteHeader({ lang, dict }: { lang: Locale; dict: Dictionary }) {
  return (
    <header className="mx-auto max-w-5xl px-5 py-5">
      <div className="flex items-center justify-between gap-4">
        <Link href={`/${lang}`} className="text-xl font-extrabold tracking-tight">{dict.brand}</Link>
        <div className="flex items-center gap-5">
          <Link href={`/${lang}#track`} className="hidden text-sm font-semibold underline-offset-4 hover:underline sm:inline">{dict.nav.track}</Link>
          <Link href={`/${lang}/account`} className="text-sm font-semibold underline-offset-4 hover:underline">{dict.account.nav}</Link>
          <CartBadge lang={lang} label={dict.cart.nav} />
          <LocaleSwitch current={lang} label={dict.nav.language} />
        </div>
      </div>
      <nav aria-label={dict.nav.menu} className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-rule pt-3">
        {LINKS.map((key) => (
          <Link key={key} href={`/${lang}/${key}`} className="text-sm font-semibold underline-offset-4 hover:underline">{dict.nav[key]}</Link>
        ))}
        <Link href={`/${lang}#track`} className="text-sm font-semibold underline-offset-4 hover:underline sm:hidden">{dict.nav.track}</Link>
      </nav>
    </header>
  );
}
