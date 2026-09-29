import { z } from 'zod';
import type { PriceTier } from '../rules/money';

/**
 * What the customer website shows, and the shapes the owner edits it with. Content is edited online only, so it
 * uses plain optimistic concurrency: every save carries the `row_version` the editor started from, and a save made
 * over someone else's newer change is refused instead of silently overwriting it.
 */

export const CONTENT_STATUSES = ['draft', 'published'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** "digital-printing": lowercase latin words joined by dashes, used in the page address. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const slug = z.string().trim().toLowerCase().max(80).regex(SLUG_RE, 'lowercase letters, digits and dashes only (e.g. digital-printing)');

const required = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable().optional();
const uuid = z.string().uuid();
const httpsUrl = z.string().trim().url().max(500).refine((v) => v.startsWith('https://'), 'must start with https://');

export const PRICE_DISPLAYS = ['exact', 'from', 'hidden'] as const;
export type PriceDisplay = (typeof PRICE_DISPLAYS)[number];

export const serviceInput = z.object({
  slug,
  title_ar: required(160),
  title_en: optional(160),
  summary_ar: optional(400),
  summary_en: optional(400),
  body_ar: optional(8000),
  body_en: optional(8000),
  cover_media_id: uuid.nullable().optional(),
  is_featured: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});
export type ServiceInput = z.input<typeof serviceInput>;

export const galleryItemInput = z.object({
  title_ar: required(160),
  title_en: optional(160),
  description_ar: optional(2000),
  description_en: optional(2000),
  service_id: uuid.nullable().optional(),
  /** The pictures, in the order they are shown. */
  media_ids: z.array(uuid).max(20).refine((ids) => new Set(ids).size === ids.length, 'a picture appears twice'),
  is_featured: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
});
export type GalleryItemInput = z.input<typeof galleryItemInput>;

export const openingHours = z.array(z.object({
  days_ar: required(60),
  days_en: optional(60),
  opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM'),
  closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM'),
})).max(7);

export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin'] as const;

export const siteSettingsInput = z.object({
  tagline_ar: optional(200),
  tagline_en: optional(200),
  about_ar: optional(4000),
  about_en: optional(4000),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/, 'international format, e.g. +96170123456').nullable().optional(),
  whatsapp: z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/, 'international format, e.g. +96170123456').nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  address_ar: optional(300),
  address_en: optional(300),
  map_url: httpsUrl.nullable().optional(),
  opening_hours: openingHours.optional(),
  social_links: z.partialRecord(z.enum(SOCIAL_NETWORKS), httpsUrl).optional(),
  hero_media_id: uuid.nullable().optional(),
  price_display: z.enum(PRICE_DISPLAYS).optional(),
});
export type SiteSettingsInput = z.input<typeof siteSettingsInput>;

export const mediaMetaInput = z.object({
  alt_ar: optional(250),
  alt_en: optional(250),
});

/** Every save names the version it was made from. */
export const versioned = <T extends z.ZodTypeAny>(schema: T) => z.object({ row_version: z.number().int().positive(), data: schema });

export const MEDIA_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  maxPixels: 50_000_000,
  /** Widths generated for the website; a picture is never enlarged beyond its own width. */
  /** 800 and 1200 exist for phones: a 412px-wide screen at density 1.75 needs ~720px, at 2.6 ~1070px — without them
   *  the browser jumps straight to the next size up (1600), several times the bytes it needs on a slow connection. */
  widths: [480, 800, 1200, 1600] as const,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
};

// ---- what the public website receives --------------------------------------------------------------------------
export interface PublicImage { alt: string; width: number; height: number; srcset: { width: number; src: string }[] }
export interface PublicService { slug: string; title: string; summary: string | null; body: string | null; image: PublicImage | null; featured: boolean }
export interface PublicGalleryItem { id: string; title: string; description: string | null; serviceSlug: string | null; images: PublicImage[]; featured: boolean }
export interface PublicProduct {
  id: string; slug: string | null; sku: string; name: string; description: string | null; unit: string; image: PublicImage | null;
  /** Ready-to-show price for the products page, following the owner's price_display setting; null means "ask for quote". */
  price: string | null; priceIsFrom: boolean;
  /** The real pricing structure, always present so the cart can quote an exact total regardless of price_display. */
  minQuantity: string; pricingModel: string; basePrice: string; priceRules: PriceTier[];
}
export interface PublicSite {
  name: string; /** The shop's registered name for legal pages; falls back to `name` on the website when not set. */ legalName: string | null;
  tagline: string | null; about: string | null; phone: string | null; whatsapp: string | null; email: string | null;
  address: string | null; mapUrl: string | null; hours: { days: string; opens: string; closes: string }[];
  social: Partial<Record<(typeof SOCIAL_NETWORKS)[number], string>>; hero: PublicImage | null; currency: string;
}
