import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';

export function healthRouter(pool: Pool): Router {
  const r = Router();
  // Unauthenticated and it touches the database, so it is the cheapest thing on the server to amplify. Generous
  // enough for a monitor, a load balancer and a person with curl all at once.
  r.get('/health', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }), async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
  });
  return r;
}
