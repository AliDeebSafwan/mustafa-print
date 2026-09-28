import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  ContentStatus, GalleryItemInput, PriceTier, PublicGalleryItem, PublicImage, PublicProduct, PublicService, PublicSite, ServiceInput, SiteSettingsInput,
} from '@mpe/shared';
import { galleryItemInput, serviceInput, siteSettingsInput } from '@mpe/shared';
import { withTransaction, type Queryable } from '../../db/pool';
import { HttpError, parseWith } from '../../http-error';
import type { AuthContext } from '../auth/types';
import type { ProcessedImage } from '../media/images';
import type { MediaStorage } from '../media/storage';

type Row = Record<string, unknown>;
type Lang = 'ar' | 'en';

export interface ContentDeps {
  pool: Pool;
  storage: MediaStorage;
  /** Called after any change the public can see, so the website refreshes at once. */
  onPublicChange: () => void;
}

/** The public address of a resized picture. The website puts its API base in front of it. */
export const PUBLIC_MEDIA_BASE = '/api/v1/public/site/media';
export const publicMediaPath = (key: string) => `${PUBLIC_MEDIA_BASE}/${key.slice('public/'.length)}`;

const pick = (row: Row, field: string, lang: Lang): string | null =>
  (lang === 'en' && row[`${field}_en`] ? String(row[`${field}_en`]) : row[`${field}_ar`] ? String(row[`${field}_ar`]) : null);

function toPublicImage(media: Row | null | undefined, lang: Lang): PublicImage | null {
  if (!media) return null;
  const variants = (media.variants as { width: number; key: string }[]) ?? [];
  return {
    alt: pick(media, 'alt', lang) ?? '',
    width: Number(media.width), height: Number(media.height),
    srcset: variants.map((v) => ({ width: v.width, src: publicMediaPath(v.key) })),
  };
}

/** A save made from an older version than what is stored is refused, never merged silently. */
async function lockVersioned(q: Queryable, table: 'services' | 'gallery_items' | 'site_settings', where: string, params: unknown[], expected: number): Promise<Row> {
  const { rows } = await q.query<Row>(`SELECT * FROM ${table} WHERE ${where} FOR UPDATE`, params);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'not_found');
  if (Number(row.row_version) !== expected) {
    throw new HttpError(409, 'version_conflict', 'Someone saved a newer version meanwhile. Reload and try again.');
  }
  return row;
}

const isUniqueViolation = (err: unknown, constraint: string) =>
  (err as { code?: string; constraint?: string }).code === '23505' && (err as { constraint?: string }).constraint === constraint;

export type ContentService = ReturnType<typeof createContentService>;

export function createContentService({ pool, storage, onPublicChange }: ContentDeps) {
  // ---- pictures ------------------------------------------------------------------------------------------------
  async function createMedia(auth: AuthContext, image: ProcessedImage, originalName: string | null): Promise<Row> {
    const id = randomUUID();
    const originalKey = `originals/${id}.${image.extension}`;
    const variants = image.variants.map((v) => ({ width: v.width, key: `public/${id}-${v.width}.webp`, bytes: v.data.byteLength }));

    // Files first, row second: a row never points at a file that does not exist.
    await storage.put(originalKey, image.original);
    await Promise.all(image.variants.map((v, i) => storage.put(variants[i]!.key, v.data)));
    try {
      const { rows } = await pool.query<Row>(
        `INSERT INTO media (id, branch_id, storage_key, original_name, mime_type, width, height, bytes, variants, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
        [id, auth.branchId, originalKey, originalName?.slice(0, 200) ?? null, image.mime, image.width, image.height,
         image.original.byteLength, JSON.stringify(variants), auth.userId]);
      return rows[0]!;
    } catch (err) {
      await Promise.all([originalKey, ...variants.map((v) => v.key)].map((k) => storage.remove(k)));
      throw err;
    }
  }

  async function updateMediaMeta(auth: AuthContext, id: string, meta: { alt_ar?: string | null; alt_en?: string | null }): Promise<Row> {
    const { rows } = await pool.query<Row>(
      `UPDATE media SET alt_ar = CASE WHEN $3 THEN $4 ELSE alt_ar END, alt_en = CASE WHEN $5 THEN $6 ELSE alt_en END
        WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, auth.branchId, 'alt_ar' in meta, meta.alt_ar ?? null, 'alt_en' in meta, meta.alt_en ?? null]);
    if (!rows[0]) throw new HttpError(404, 'not_found');
    onPublicChange();
    return rows[0];
  }

  /** A picture still shown somewhere cannot be deleted; the owner removes it from there first. */
  async function deleteMedia(auth: AuthContext, id: string): Promise<void> {
    const media = await withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row>('SELECT * FROM media WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, auth.branchId]);
      const row = rows[0];
      if (!row) throw new HttpError(404, 'not_found');
      const used = await client.query(
        `SELECT 1 FROM services WHERE cover_media_id = $1 AND deleted_at IS NULL
         UNION ALL SELECT 1 FROM gallery_item_media gm JOIN gallery_items g ON g.id = gm.gallery_item_id WHERE gm.media_id = $1 AND g.deleted_at IS NULL
         UNION ALL SELECT 1 FROM products WHERE cover_media_id = $1 AND deleted_at IS NULL
         UNION ALL SELECT 1 FROM site_settings WHERE hero_media_id = $1
         LIMIT 1`, [id]);
      if (used.rowCount) throw new HttpError(409, 'media_in_use', 'This picture is still shown on the website. Remove it from there first.');
      await client.query('UPDATE media SET deleted_at = clock_timestamp() WHERE id = $1', [id]);
      return row;
    });
    const keys = [String(media.storage_key), ...((media.variants as { key: string }[]) ?? []).map((v) => v.key)];
    await Promise.all(keys.map((k) => storage.remove(k)));
  }

  const listMedia = async (auth: AuthContext): Promise<Row[]> =>
    (await pool.query<Row>('SELECT * FROM media WHERE branch_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [auth.branchId])).rows;

  /** Publishing needs every picture on the page to be described: search engines and blind visitors read it. */
  async function assertDescribed(q: Queryable, branchId: string, mediaIds: (string | null | undefined)[]): Promise<void> {
    const ids = mediaIds.filter((x): x is string => Boolean(x));
    if (ids.length === 0) return;
    const { rows } = await q.query<{ id: string; alt_ar: string | null }>(
      'SELECT id, alt_ar FROM media WHERE branch_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL', [branchId, ids]);
    if (rows.length !== new Set(ids).size) throw new HttpError(400, 'invalid_request', 'A picture on this page no longer exists');
    if (rows.some((r) => !r.alt_ar?.trim())) {
      throw new HttpError(400, 'missing_alt_text', 'Describe every picture (in Arabic at least) before publishing');
    }
  }

  // ---- services ------------------------------------------------------------------------------------------------
  const listServices = async (auth: AuthContext): Promise<Row[]> =>
    (await pool.query<Row>('SELECT * FROM services WHERE branch_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at', [auth.branchId])).rows;

  async function saveService(auth: AuthContext, id: string | null, raw: unknown, expectedVersion?: number): Promise<Row> {
    const d = parseWith(serviceInput, raw);
    try {
      return await withTransaction(pool, async (client) => {
        if (id) {
          const current = await lockVersioned(client, 'services', 'id = $1 AND branch_id = $2 AND deleted_at IS NULL', [id, auth.branchId], expectedVersion ?? 0);
          if (current.status === 'published') await assertDescribed(client, auth.branchId, [d.cover_media_id]);
          const { rows } = await client.query<Row>(
            `UPDATE services SET slug=$3, title_ar=$4, title_en=$5, summary_ar=$6, summary_en=$7, body_ar=$8, body_en=$9, cover_media_id=$10,
                    is_featured=coalesce($11, is_featured), sort_order=coalesce($12, sort_order), updated_by=$13
              WHERE id = $1 AND branch_id = $2 RETURNING *`,
            [id, auth.branchId, d.slug, d.title_ar, d.title_en ?? null, d.summary_ar ?? null, d.summary_en ?? null, d.body_ar ?? null,
             d.body_en ?? null, d.cover_media_id ?? null, d.is_featured ?? null, d.sort_order ?? null, auth.userId]);
          if (current.status === 'published') onPublicChange();
          return rows[0]!;
        }
        const { rows } = await client.query<Row>(
          `INSERT INTO services (branch_id, slug, title_ar, title_en, summary_ar, summary_en, body_ar, body_en, cover_media_id, is_featured, sort_order, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,false),coalesce($11,0),$12) RETURNING *`,
          [auth.branchId, d.slug, d.title_ar, d.title_en ?? null, d.summary_ar ?? null, d.summary_en ?? null, d.body_ar ?? null,
           d.body_en ?? null, d.cover_media_id ?? null, d.is_featured ?? null, d.sort_order ?? null, auth.userId]);
        return rows[0]!;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'services_slug_uq')) throw new HttpError(409, 'slug_taken', 'Another service already uses this address');
      if ((err as { code?: string }).code === '23503') throw new HttpError(400, 'invalid_request', 'The chosen picture does not exist');
      throw err;
    }
  }

  async function setServiceStatus(auth: AuthContext, id: string, status: ContentStatus, expectedVersion: number): Promise<Row> {
    const row = await withTransaction(pool, async (client) => {
      const current = await lockVersioned(client, 'services', 'id = $1 AND branch_id = $2 AND deleted_at IS NULL', [id, auth.branchId], expectedVersion);
      if (status === 'published') await assertDescribed(client, auth.branchId, [current.cover_media_id as string | null]);
      const { rows } = await client.query<Row>('UPDATE services SET status = $3, updated_by = $4 WHERE id = $1 AND branch_id = $2 RETURNING *', [id, auth.branchId, status, auth.userId]);
      return rows[0]!;
    });
    onPublicChange();
    return row;
  }

  async function deleteService(auth: AuthContext, id: string, expectedVersion: number): Promise<void> {
    await withTransaction(pool, async (client) => {
      await lockVersioned(client, 'services', 'id = $1 AND branch_id = $2 AND deleted_at IS NULL', [id, auth.branchId], expectedVersion);
      // Showroom work filed under this service stays, simply no longer filed under it.
      await client.query('UPDATE gallery_items SET service_id = NULL WHERE service_id = $1', [id]);
      await client.query('UPDATE services SET deleted_at = clock_timestamp(), status = $2 WHERE id = $1', [id, 'draft']);
    });
    onPublicChange();
  }

  // ---- showroom ------------------------------------------------------------------------------------------------
  async function withPictures(q: Queryable, items: Row[]): Promise<Row[]> {
    if (items.length === 0) return items;
    const { rows } = await q.query<Row>(
      `SELECT gm.gallery_item_id, gm.media_id FROM gallery_item_media gm WHERE gm.gallery_item_id = ANY($1::uuid[]) ORDER BY gm.sort_order`,
      [items.map((i) => i.id)]);
    return items.map((item) => ({ ...item, media_ids: rows.filter((r) => r.gallery_item_id === item.id).map((r) => r.media_id) }));
  }

  const listGallery = async (auth: AuthContext): Promise<Row[]> =>
    withPictures(pool, (await pool.query<Row>('SELECT * FROM gallery_items WHERE branch_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at DESC', [auth.branchId])).rows);

  async function saveGalleryItem(auth: AuthContext, id: string | null, raw: unknown, expectedVersion?: number): Promise<Row> {
    const d: ReturnType<typeof galleryItemInput.parse> = parseWith(galleryItemInput, raw);
    const row = await withTransaction(pool, async (client) => {
      let saved: Row;
      if (id) {
        const current = await lockVersioned(client, 'gallery_items', 'id = $1 AND branch_id = $2 AND deleted_at IS NULL', [id, auth.branchId], expectedVersion ?? 0);
        if (current.status === 'published') await assertDescribed(client, auth.branchId, d.media_ids);
        saved = (await client.query<Row>(
          `UPDATE gallery_items SET title_ar=$3, title_en=$4, description_ar=$5, description_en=$6, service_id=$7,
                  is_featured=coalesce($8, is_featured), sort_order=coalesce($9, sort_order), updated_by=$10
            WHERE id = $1 AND branch_id = $2 RETURNING *`,
          [id, auth.branchId, d.title_ar, d.title_en ?? null, d.description_ar ?? null, d.description_en ?? null, d.service_id ?? null,
           d.is_featured ?? null, d.sort_order ?? null, auth.userId])).rows[0]!;
        await client.query('DELETE FROM gallery_item_media WHERE gallery_item_id = $1', [id]);
      } else {
        saved = (await client.query<Row>(
          `INSERT INTO gallery_items (branch_id, title_ar, title_en, description_ar, description_en, service_id, is_featured, sort_order, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,coalesce($7,false),coalesce($8,0),$9) RETURNING *`,
          [auth.branchId, d.title_ar, d.title_en ?? null, d.description_ar ?? null, d.description_en ?? null, d.service_id ?? null,
           d.is_featured ?? null, d.sort_order ?? null, auth.userId])).rows[0]!;
      }
      for (const [index, mediaId] of d.media_ids.entries()) {
        await client.query('INSERT INTO gallery_item_media (gallery_item_id, media_id, branch_id, sort_order) VALUES ($1,$2,$3,$4)', [saved.id, mediaId, auth.branchId, index]);
      }
      return (await withPictures(client, [saved]))[0]!;
    }).catch((err) => {
      if ((err as { code?: string }).code === '23503') throw new HttpError(400, 'invalid_request', 'A chosen picture or service does not exist');
      throw err;
    });
    if (row.status === 'published') onPublicChange();
    return row;
  }

  async function setGalleryStatus(auth: AuthContext, id: string, status: ContentStatus, expectedVersion: number): Promise<Row> {
    const row = await withTransaction(pool, async (client) => {
      await lockVersioned(client, 'gallery_items', 'id = $1 AND branch_id = $2 AND deleted_at IS NULL', [id, auth.branchId], expectedVersion);
      if (status === 'published') {
        const pictures = (await client.query<{ media_id: string }>('SELECT media_id FROM gallery_item_media WHERE gallery_item_id = $1', [id])).rows.map((r) => r.media_id);
        if (pictures.length === 0) throw new HttpError(400, 'invalid_request', 'Add at least one picture before publishing');
        await assertDescribed(client, auth.branchId, pictures);
      }
      const { rows } = await client.query<Row>('UPDATE gallery_items SET status = $3, updated_by = $4 WHERE id = $1 AND branch_id = $2 RETURNING *', [id, auth.branchId, status, auth.userId]);
      return (await withPictures(client, rows))[0]!;
    });
    onPublicChange();
    return row;
  }

  async function deleteGalleryItem(auth: AuthContext, id: string, expectedVersion: number): Promise<void> {
    await withTransaction(pool, async (client) => {
      await lockVersioned(client, 'gallery_items', 'id = $1 AND branch_id = $2 AND deleted_at IS NULL', [id, auth.branchId], expectedVersion);
      await client.query(`UPDATE gallery_items SET deleted_at = clock_timestamp(), status = 'draft' WHERE id = $1`, [id]);
      await client.query('DELETE FROM gallery_item_media WHERE gallery_item_id = $1', [id]);
    });
    onPublicChange();
  }

  // ---- the shop's details ----------------------------------------------------------------------------------------
  async function getSettings(branchId: string): Promise<Row> {
    await pool.query('INSERT INTO site_settings (branch_id) VALUES ($1) ON CONFLICT (branch_id) DO NOTHING', [branchId]);
    return (await pool.query<Row>('SELECT * FROM site_settings WHERE branch_id = $1', [branchId])).rows[0]!;
  }

  async function saveSettings(auth: AuthContext, raw: unknown, expectedVersion: number): Promise<Row> {
    const d: SiteSettingsInput = parseWith(siteSettingsInput, raw);
    await getSettings(auth.branchId);
    const row = await withTransaction(pool, async (client) => {
      await lockVersioned(client, 'site_settings', 'branch_id = $1', [auth.branchId], expectedVersion);
      if (d.hero_media_id) await assertDescribed(client, auth.branchId, [d.hero_media_id]);
      const { rows } = await client.query<Row>(
        `UPDATE site_settings SET tagline_ar=$2, tagline_en=$3, about_ar=$4, about_en=$5, phone=$6, whatsapp=$7, email=$8, address_ar=$9, address_en=$10,
                map_url=$11, opening_hours=$12::jsonb, social_links=$13::jsonb, hero_media_id=$14, price_display=coalesce($15, price_display), updated_by=$16
          WHERE branch_id = $1 RETURNING *`,
        [auth.branchId, d.tagline_ar ?? null, d.tagline_en ?? null, d.about_ar ?? null, d.about_en ?? null, d.phone ?? null, d.whatsapp ?? null,
         d.email ?? null, d.address_ar ?? null, d.address_en ?? null, d.map_url ?? null, JSON.stringify(d.opening_hours ?? []),
         JSON.stringify(d.social_links ?? {}), d.hero_media_id ?? null, d.price_display ?? null, auth.userId]);
      return rows[0]!;
    });
    onPublicChange();
    return row;
  }

  // ---- what the public website reads (published only) -----------------------------------------------------------
  async function mediaById(ids: unknown[]): Promise<Map<string, Row>> {
    const wanted = ids.filter((x): x is string => typeof x === 'string');
    if (wanted.length === 0) return new Map();
    const { rows } = await pool.query<Row>('SELECT * FROM media WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [wanted]);
    return new Map(rows.map((r) => [String(r.id), r]));
  }

  async function publicSite(branchId: string, lang: Lang): Promise<PublicSite> {
    const [settings, branch] = await Promise.all([
      getSettings(branchId),
      pool.query<Row>('SELECT name_ar, name_en, legal_name_ar, legal_name_en, base_currency FROM branches WHERE id = $1', [branchId]).then((r) => r.rows[0]!),
    ]);
    const media = await mediaById([settings.hero_media_id]);
    const hours = (settings.opening_hours as { days_ar: string; days_en?: string | null; opens: string; closes: string }[]) ?? [];
    return {
      name: pick(branch, 'name', lang) ?? '', legalName: pick(branch, 'legal_name', lang), tagline: pick(settings, 'tagline', lang), about: pick(settings, 'about', lang),
      phone: (settings.phone as string | null) ?? null, whatsapp: (settings.whatsapp as string | null) ?? null, email: (settings.email as string | null) ?? null,
      address: pick(settings, 'address', lang), mapUrl: (settings.map_url as string | null) ?? null,
      hours: hours.map((h) => ({ days: (lang === 'en' && h.days_en) || h.days_ar, opens: h.opens, closes: h.closes })),
      social: (settings.social_links as PublicSite['social']) ?? {},
      hero: toPublicImage(settings.hero_media_id ? media.get(String(settings.hero_media_id)) : null, lang),
      currency: String(branch.base_currency),
    };
  }

  async function publicServices(branchId: string, lang: Lang, slugFilter?: string): Promise<PublicService[]> {
    const { rows } = await pool.query<Row>(
      `SELECT * FROM services WHERE branch_id = $1 AND status = 'published' AND deleted_at IS NULL ${slugFilter ? 'AND slug = $2' : ''}
        ORDER BY sort_order, created_at`, slugFilter ? [branchId, slugFilter] : [branchId]);
    const media = await mediaById(rows.map((r) => r.cover_media_id));
    return rows.map((r) => ({
      slug: String(r.slug), title: pick(r, 'title', lang)!, summary: pick(r, 'summary', lang), body: pick(r, 'body', lang),
      image: toPublicImage(r.cover_media_id ? media.get(String(r.cover_media_id)) : null, lang), featured: Boolean(r.is_featured),
    }));
  }

  async function publicGallery(branchId: string, lang: Lang, serviceSlug?: string): Promise<PublicGalleryItem[]> {
    const { rows } = await pool.query<Row>(
      `SELECT g.*, s.slug AS service_slug FROM gallery_items g
         LEFT JOIN services s ON s.id = g.service_id AND s.status = 'published' AND s.deleted_at IS NULL
        WHERE g.branch_id = $1 AND g.status = 'published' AND g.deleted_at IS NULL ${serviceSlug ? 'AND s.slug = $2' : ''}
        ORDER BY g.sort_order, g.created_at DESC`, serviceSlug ? [branchId, serviceSlug] : [branchId]);
    const items = await withPictures(pool, rows);
    const media = await mediaById(items.flatMap((i) => i.media_ids as string[]));
    return items.map((r) => ({
      id: String(r.id), title: pick(r, 'title', lang)!, description: pick(r, 'description', lang),
      serviceSlug: (r.service_slug as string | null) ?? null, featured: Boolean(r.is_featured),
      images: (r.media_ids as string[]).map((id) => toPublicImage(media.get(id), lang)).filter((x): x is PublicImage => x !== null),
    }));
  }

  async function publicProducts(branchId: string, lang: Lang, serviceSlug?: string): Promise<PublicProduct[]> {
    const settings = await getSettings(branchId);
    const display = String(settings.price_display);
    const { rows } = await pool.query<Row>(
      `SELECT p.* FROM products p
         LEFT JOIN services s ON s.id = p.service_id AND s.status = 'published' AND s.deleted_at IS NULL
        WHERE p.branch_id = $1 AND p.is_public AND p.is_active AND p.deleted_at IS NULL ${serviceSlug ? 'AND s.slug = $2' : ''}
        ORDER BY p.sort_order, p.name_ar`, serviceSlug ? [branchId, serviceSlug] : [branchId]);
    const media = await mediaById(rows.map((r) => r.cover_media_id));
    return rows.map((r) => {
      // With quantity tiers the base price is the most it costs per unit, so "from" shows the cheapest tier.
      const tiers = ((r.price_rules as { unit_price: string }[]) ?? []).map((t) => Number(t.unit_price));
      const lowest = r.pricing_model === 'tiered' && tiers.length ? Math.min(Number(r.base_price), ...tiers) : Number(r.base_price);
      return {
        id: String(r.id), slug: (r.slug as string | null) ?? null, sku: String(r.sku), name: String(lang === 'en' ? r.name_en : r.name_ar),
        description: pick(r, 'description', lang), unit: String(r.unit),
        image: toPublicImage(r.cover_media_id ? media.get(String(r.cover_media_id)) : null, lang),
        price: display === 'hidden' ? null : String(display === 'from' ? lowest : Number(r.base_price)),
        priceIsFrom: display === 'from',
        // Always exposed, even when price_display is 'hidden': the cart still needs to quote an exact total once
        // someone actually orders. Hiding the price only affects the browse page, not the order itself.
        minQuantity: String(r.min_quantity), pricingModel: String(r.pricing_model), basePrice: String(r.base_price),
        priceRules: (r.price_rules as PriceTier[]) ?? [],
      };
    });
  }

  return {
    createMedia, updateMediaMeta, deleteMedia, listMedia,
    listServices, saveService, setServiceStatus, deleteService,
    listGallery, saveGalleryItem, setGalleryStatus, deleteGalleryItem,
    getSettings, saveSettings,
    publicSite, publicServices, publicGallery, publicProducts,
  };
}

export type { GalleryItemInput, ServiceInput };
