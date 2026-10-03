import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError, parseWith } from '../../http-error';
import { requirePermission } from '../../modules/auth/middleware';
import type { CustomerAccountsAdminService } from '../../modules/customer-auth/customer-accounts-admin.service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => { const r = uuid.safeParse(v); if (!r.success) throw new HttpError(404, 'not_found'); return r.data; };

/** Website accounts, for the owner only: `customer_accounts:manage` is never in a staff role and is not delegable. */
export function adminCustomerAccountsRouter(deps: { accounts: CustomerAccountsAdminService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate, requirePermission('customer_accounts:manage'));

  router.get('/', async (req, res) => {
    res.json(await deps.accounts.list(req.auth!, typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : ''));
  });
  router.get('/:id', async (req, res) => { res.json(await deps.accounts.detail(req.auth!, idOf(req.params.id))); });
  router.post('/:id/deactivate', async (req, res) => { res.json(await deps.accounts.setActive(req.auth!, idOf(req.params.id), false)); });
  router.post('/:id/reactivate', async (req, res) => { res.json(await deps.accounts.setActive(req.auth!, idOf(req.params.id), true)); });
  router.post('/:id/approve', async (req, res) => { res.json(await deps.accounts.approve(req.auth!, idOf(req.params.id))); });
  router.post('/:id/merge', async (req, res) => {
    const { customer_id } = parseWith(z.object({ customer_id: uuid }), req.body);
    res.json(await deps.accounts.merge(req.auth!, idOf(req.params.id), customer_id));
  });
  return router;
}
