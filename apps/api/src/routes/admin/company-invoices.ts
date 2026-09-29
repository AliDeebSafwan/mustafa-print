import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError, parseWith } from '../../http-error';
import { requirePermission } from '../../modules/auth/middleware';
import type { CompanyInvoiceService } from '../../modules/orders/company-invoices.service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => { const r = uuid.safeParse(v); if (!r.success) throw new HttpError(404, 'not_found'); return r.data; };

/** Consolidated invoices for company customers. Online, like single-order invoices: numbering needs the server. */
export function companyInvoicesRouter(deps: { invoices: CompanyInvoiceService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate);
  router.get('/', requirePermission('orders:read'), async (req, res) => { res.json(await deps.invoices.list(req.auth!, idOf(req.query.customer_id))); });
  router.get('/unbilled', requirePermission('orders:read'), async (req, res) => { res.json(await deps.invoices.unbilled(req.auth!, idOf(req.query.customer_id))); });
  router.post('/', requirePermission('orders:update'), async (req, res) => {
    const body = parseWith(z.object({ customer_id: uuid, order_ids: z.array(uuid).min(1).max(500) }), req.body);
    res.status(201).json(await deps.invoices.issue(req.auth!, body.customer_id, body.order_ids));
  });
  router.get('/:id', requirePermission('orders:read'), async (req, res) => { res.json(await deps.invoices.get(req.auth!, idOf(req.params.id))); });
  return router;
}
