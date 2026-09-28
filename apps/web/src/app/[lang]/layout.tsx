import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LOCALES, dirFor, isLocale } from "@mpe/shared";
import "../globals.css";
import { ColorBar } from "@/components/color-bar";
import { CartProvider } from "@/lib/cart";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDictionary } from "@/lib/dictionaries";
import { siteUrl } from "@/lib/seo";
import { getSite } from "@/lib/site";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: dict.meta.title, template: `%s | ${dict.meta.title}` },
    description: dict.meta.description,
    openGraph: { siteName: dict.meta.title, locale: lang === "ar" ? "ar_LB" : "en_US", type: "website" },
  };
}

export default async function LangLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [dict, site] = await Promise.all([getDictionary(lang), getSite(lang)]);

  return (
    <html lang={lang} dir={dirFor(lang)}>
      <head>
        {/* The font this page's language needs first, fetched with the HTML so it usually arrives within the short
            window font-display: optional allows. Arabic pages also show Latin digits and emails. */}
        {(lang === "ar" ? ["arabic", "latin"] : ["latin"]).map((subset) => (
          <link key={subset} rel="preload" href={`/fonts/cairo-${subset}-wght-normal.woff2`} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body className="min-h-dvh bg-paper text-ink">
        <CartProvider>
          <ColorBar />
          <SiteHeader lang={lang} dict={dict} />
          <main className="mx-auto max-w-5xl px-5">{children}</main>
          <SiteFooter site={site} dict={dict} lang={lang} />
        </CartProvider>
      </body>
    </html>
  );
}
