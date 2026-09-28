import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import type { PushService } from '../modules/push/push.service';

const subscriptionInput = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Any staff member who can see orders may turn this on for their own browser — it is their own alert, not a
 *  branch-wide setting, so no separate permission beyond seeing orders at all is needed. */
export function pushRouter(deps: { push: PushService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate, requirePermission('orders:read'));

  router.get('/vapid-public-key', (_req, res) => {
    res.json(deps.push.configured ? { publicKey: deps.push.publicKey } : { publicKey: null });
  });
  router.post('/subscribe', async (req, res) => {
    const body = parseWith(subscriptionInput, req.body);
    await deps.push.subscribe(req.auth!, { ...body, userAgent: req.get('user-agent') });
    res.sendStatus(204);
  });
  router.post('/unsubscribe', async (req, res) => {
    const { endpoint } = parseWith(z.object({ endpoint: z.string().url() }), req.body);
    await deps.push.unsubscribe(req.auth!, endpoint);
    res.sendStatus(204);
  });
  return router;
}
