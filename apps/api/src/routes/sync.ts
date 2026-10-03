import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { pullQuerySchema, pushRequestSchema } from '@mpe/shared';
import type { Env } from '../config/env';
import { parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import { pullChanges } from '../modules/sync/pull';
import { processPush } from '../modules/sync/push';

/**
 * Offline sync. Contract: packages/shared/src/sync.ts and mutations.ts; design: docs/database/DB-DESIGN.md.
 * The caller's branch always comes from the authenticated user, never from the request.
 */
export function syncRouter(deps: { pool: Pool; env: Env; authenticate: RequestHandler; onPublicChange?: () => void }): Router {
  const { pool, env } = deps;
  const router = Router();
  router.use(deps.authenticate, requirePermission('sync:use'));

  /**
   * A guard against a looping client, nothing more. One push may carry 200 mutations, so counting REQUESTS cannot bound
   * what a call costs — anything expensive is capped where it is spent instead (see handlers/notifications.ts). The
   * number is therefore set far above any real client: a device syncs every 30 seconds (startAutoSync) and batches its
   * whole outbox, so a person on several devices makes single digits per minute, while a runaway loop makes thousands.
   *
   * Keyed on the user, not the address: every tablet in the shop shares one connection, so an IP limit would throttle a
   * busy counter while leaving a stolen token on its own address untouched.
   */
  router.use(rateLimit({
    windowMs: 60_000, limit: 1200, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'too_many_attempts' },
    keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
  }));

  router.post('/push', async (req, res) => {
    const request = parseWith(pushRequestSchema, req.body);
    res.json(await processPush({ pool, publicWebUrl: env.PUBLIC_WEB_URL, onPublicChange: deps.onPublicChange }, req.auth!, request));
  });

  router.get('/pull', async (req, res) => {
    const query = parseWith(pullQuerySchema, req.query);
    res.json(await pullChanges({ pool, lagSeconds: env.SYNC_PULL_LAG_SECONDS }, req.auth!, query));
  });

  return router;
}
