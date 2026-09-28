import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { SLUG_RE } from '@mpe/shared';
import { HttpError } from '../http-error';
import type { ContentService } from '../modules/content/content.service';
import type { MediaStorage } from '../modules/media/storage';

const PUBLIC_FILE = /^[0-9a-f-]{36}-\d{2,4}\.webp$/;
const langOf = (value: unknown): 'ar' | 'en' => (value === 'en' ? 'en' : 'ar');

/**
 * What anyone may read: the shop's published services, showroom and products, and its resized pictures.
 * Drafts never leave the server, and original uploads are never served.
 */
export function publicSiteRouter(deps: { pool: Pool; content: ContentService; storage: MediaStorage; branchCode: string }): Router {
  const { content, storage } = deps;
  const router = Router();
  // Generous: the website's own server reads these, and so do visitors' browsers for pictures.
  router.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  let branchId: string | null = null;
  const branch = async (): Promise<string> => {
    if (branchId) return branchId;
    const { rows } = await deps.pool.query<{ id: string }>('SELECT id FROM branches WHERE lower(code) = lower($1) AND deleted_at IS NULL', [deps.branchCode]);
    if (!rows[0]) throw new HttpError(404, 'not_found', `No branch with code ${deps.branchCode}; set PUBLIC_BRANCH_CODE`);
    return (branchId = rows[0].id);
  };

  router.get('/site', async (req, res) => { res.json(await content.publicSite(await branch(), langOf(req.query.lang))); });
  router.get('/services', async (req, res) => { res.json(await content.publicServices(await branch(), langOf(req.query.lang))); });
  router.get('/services/:slug', async (req, res) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) throw new HttpError(404, 'not_found');
    const [service] = await content.publicServices(await branch(), langOf(req.query.lang), slug);
    if (!service) throw new HttpError(404, 'not_found');
    res.json(service);
  });
  router.get('/gallery', async (req, res) => {
    const service = typeof req.query.service === 'string' && SLUG_RE.test(req.query.service) ? req.query.service : undefined;
    res.json(await content.publicGallery(await branch(), langOf(req.query.lang), service));
  });
  router.get('/products', async (req, res) => {
    const service = typeof req.query.service === 'string' && SLUG_RE.test(req.query.service) ? req.query.service : undefined;
    res.json(await content.publicProducts(await branch(), langOf(req.query.lang), service));
  });

  router.get('/media/:file', async (req, res) => {
    const file = String(req.params.file);
    if (!PUBLIC_FILE.test(file)) throw new HttpError(404, 'not_found');
    const data = await storage.get(`public/${file}`);
    if (!data) throw new HttpError(404, 'not_found');
    res.set({
      'Content-Type': 'image/webp',
      // The name is unique to the picture and width, so it can be cached forever.
      'Cache-Control': 'public, max-age=31536000, immutable',
      // The website lives on another origin; without this, browsers refuse to show the picture.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    }).send(data);
  });

  return router;
}
