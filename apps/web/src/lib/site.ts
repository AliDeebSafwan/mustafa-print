import "server-only";
import type { Locale, PublicGalleryItem, PublicImage, PublicProduct, PublicService, PublicSite } from "@mpe/shared";

/**
 * Everything the owner publishes, read by the website's server. Cached and tagged "site": the API tells the website
 * when the owner changes something (see app/api/revalidate), and even without that the pages refresh within a minute.
 */
export const SITE_TAG = "site";
const REFRESH_SECONDS = 60;

/** The API as the website's own server reaches it (may be an internal address). */
const internal = () => process.env.API_INTERNAL_URL ?? "http://localhost:4000";
/** The API as a visitor's browser reaches it, for pictures. */
export const publicApiUrl = () => (process.env.PUBLIC_API_URL ?? internal()).replace(/\/$/, "");

/**
 * During `next build` the API is usually not running (it is built in a separate container). Pages built then are
 * empty and the deployment warms them right after start-up (see README). At run time a failure is thrown on purpose:
 * the website then keeps showing the last good version of the page instead of caching an empty one.
 */
const building = () => process.env.NEXT_PHASE === "phase-production-build";

async function read<T>(path: string, lang: Locale): Promise<T | null> {
  const separator = path.includes("?") ? "&" : "?";
  let res: Response;
  try {
    res = await fetch(`${internal()}/api/v1/public/site${path}${separator}lang=${lang}`, {
      next: { revalidate: REFRESH_SECONDS, tags: [SITE_TAG] },
    });
  } catch (err) {
    if (building()) return null;
    throw err;
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    if (building()) return null;
    throw new Error(`API responded ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

/** Null only while building without an API; pages then render their empty state. */
export const getSite = (lang: Locale) => read<PublicSite>("/site", lang);
export const getServices = async (lang: Locale) => (await read<PublicService[]>("/services", lang)) ?? [];
export const getService = (lang: Locale, slug: string) => read<PublicService>(`/services/${encodeURIComponent(slug)}`, lang);
export const getGallery = async (lang: Locale, service?: string) =>
  (await read<PublicGalleryItem[]>(`/gallery${service ? `?service=${encodeURIComponent(service)}` : ""}`, lang)) ?? [];
export const getProducts = async (lang: Locale, service?: string) =>
  (await read<PublicProduct[]>(`/products${service ? `?service=${encodeURIComponent(service)}` : ""}`, lang)) ?? [];

/** srcset/src for an <img>, pointing at the API's public picture addresses. */
export function imageAttrs(image: PublicImage) {
  const base = publicApiUrl();
  const smallest = image.srcset[0];
  return {
    src: smallest ? `${base}${smallest.src}` : "",
    srcSet: image.srcset.map((v) => `${base}${v.src} ${v.width}w`).join(", "),
    width: image.width,
    height: image.height,
    alt: image.alt,
  };
}

export const whatsappLink = (phone: string, text?: string) =>
  `https://wa.me/${phone.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
