import Link from "next/link";
import type { Locale } from "@mpe/shared";
import type { Dictionary } from "@/lib/dictionaries";
import { BrandMark } from "../ui/brand-mark";
import { CartBadge } from "../cart/cart-badge";
import { LocaleSwitch } from "./locale-switch";
import { MobileMenu } from "./mobile-menu";

const LINKS = ["services", "studio", "products", "gallery", "contact"] as const;

/** The top of every page: the name, the five places people go, and (on phones) one menu button instead of two rows of links. */
export function SiteHeader({ lang, dict }: { lang: Locale; dict: Dictionary }) {
  const items = [
    ...LINKS.map((key) => ({ href: `/${lang}/${key}`, label: dict.nav[key] })),
    { href: `/${lang}#track`, label: dict.nav.track },
    { href: `/${lang}/account`, label: dict.account.nav },
  ];
  return (
    <header className="relative border-b border-rule bg-paper/70">
      <div className="bar flex items-center justify-between gap-2 py-3">
        <Link href={`/${lang}`} className="flex min-h-11 items-center gap-2 sm:gap-2.5" aria-label={dict.brand}>
          <BrandMark />
          <span className="font-display text-[1.2rem] leading-none font-extrabold whitespace-nowrap max-[360px]:text-[1.02rem] sm:text-[1.35rem]">{dict.brand}</span>
        </Link>
        <nav aria-label={dict.nav.menu} className="hidden items-center gap-0.5 xl:flex">
          {LINKS.map((key) => <Link key={key} href={`/${lang}/${key}`} className="navlink">{dict.nav[key]}</Link>)}
        </nav>
        <div className="flex items-center gap-1 sm:gap-1.5">
          <Link href={`/${lang}#track`} className="navlink hidden xl:inline-flex">{dict.nav.track}</Link>
          <Link href={`/${lang}/account`} className="navlink hidden xl:inline-flex">{dict.account.nav}</Link>
          <CartBadge lang={lang} label={dict.cart.nav} />
          <span className="hidden xl:inline-flex"><LocaleSwitch current={lang} label={dict.nav.language} /></span>
          <MobileMenu lang={lang} items={items} label={dict.nav.menu} close={dict.nav.close} languageLabel={dict.nav.language} />
        </div>
      </div>
    </header>
  );
}
