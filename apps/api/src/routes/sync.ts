import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { pullQuerySchema, pushRequestSchema } from '@mpe/shared';
import type { Env } from '../config/env';
import { parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import { pullChanges } from '../modules/sync/pull';
import { processPush } from '../modules/sync/push';

/**
 * Offline sync. Contract: packages/shared/src/sync.ts and mutations.ts; design: docs/DB-DESIGN.md.
 * The caller's branch always comes from the authenticated user, never from the request.
 */
export function syncRouter(deps: { pool: Pool; env: Env; authenticate: RequestHandler; onPublicChange?: () => void }): Router {
  const { pool, env } = deps;
  const router = Router();
  router.use(deps.authenticate, requirePermission('sync:use'));

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
