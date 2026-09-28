import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { PUBLIC_CODE_RE, quoteInput } from '@mpe/shared';
import { HttpError, parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import type { QuotesService } from '../modules/quotes/quotes.service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => { const r = uuid.safeParse(v); if (!r.success) throw new HttpError(404, 'not_found'); return r.data; };
const codeOf = (v: unknown) => { const code = String(v ?? '').toUpperCase(); if (!PUBLIC_CODE_RE.test(code)) throw new HttpError(404, 'not_found'); return code; };

/** Staff issue and follow quotes. Online only, like invoices: a quote is office work, not the shop floor. */
export function adminQuotesRouter(deps: { quotes: QuotesService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate);
  router.get('/', requirePermission('orders:read'), async (req, res) => { res.json(await deps.quotes.list(req.auth!)); });
  router.post('/', requirePermission('orders:create'), async (req, res) => {
    res.status(201).json(await deps.quotes.create(req.auth!, parseWith(quoteInput, req.body)));
  });
  router.get('/:id', requirePermission('orders:read'), async (req, res) => { res.json(await deps.quotes.detail(req.auth!, idOf(req.params.id))); });
  router.post('/:id/cancel', requirePermission('orders:update'), async (req, res) => { res.json(await deps.quotes.cancel(req.auth!, idOf(req.params.id))); });
  return router;
}

/** The customer's link. The code is the only credential, exactly like an order's tracking code. */
export function publicQuotesRouter(deps: { quotes: QuotesService }): Router {
  const router = Router();
  router.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' } }));
  router.get('/:code', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await deps.quotes.view(codeOf(req.params.code)));
  });
  router.post('/:code/accept', async (req, res) => { res.json(await deps.quotes.accept(codeOf(req.params.code))); });
  router.post('/:code/decline', async (req, res) => {
    const { reason } = parseWith(z.object({ reason: z.string().max(1000).optional() }), req.body ?? {});
    await deps.quotes.decline(codeOf(req.params.code), reason);
    res.sendStatus(204);
  });
  return router;
}
