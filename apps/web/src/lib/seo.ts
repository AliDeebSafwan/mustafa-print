import type { Metadata } from "next";
import { LOCALES, type Locale } from "@mpe/shared";

/** The site's public address, used for canonical links, the sitemap and link previews. */
export const siteUrl = () => (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Canonical and language alternates for a page, so search engines know the Arabic and English versions are the
 * same page and show each person the one in their language.
 */
export function alternates(lang: Locale, path: string): Metadata["alternates"] {
  const suffix = path === "/" ? "" : path;
  return {
    canonical: `/${lang}${suffix}`,
    languages: { ...Object.fromEntries(LOCALES.map((l) => [l, `/${l}${suffix}`])), "x-default": `/ar${suffix}` },
  };
}
