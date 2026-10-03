import type { MetadataRoute } from "next";
import { LOCALES } from "@mpe/shared";
import { siteUrl } from "@/lib/seo";
import { getServices } from "@/lib/site";

export const revalidate = 3600;

/** Every public page in both languages, each pointing at its twin, so search engines index both. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const services = await getServices("ar");
  const paths = ["", "/services", "/studio", "/gallery", "/products", "/contact", "/privacy", "/terms", ...services.map((s) => `/services/${s.slug}`)];
  return paths.flatMap((path) => LOCALES.map((lang) => ({
    url: `${base}/${lang}${path}`,
    alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l, `${base}/${l}${path}`])) },
  })));
}
