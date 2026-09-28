import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Order tracking and account pages are private: never indexed.
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/ar/track/", "/en/track/", "/ar/account", "/en/account", "/ar/quote/", "/en/quote/", "/ar/proof/", "/en/proof/", "/api/"] }], sitemap: `${siteUrl()}/sitemap.xml` };
}
