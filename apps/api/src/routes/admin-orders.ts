import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { decimal } from '@mpe/shared';
import { HttpError, parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import type { InvoiceService } from '../modules/orders/invoices.service';
import type { WebOrderService } from '../modules/orders/web-orders.service';

const uuid = z.string().uuid();
const idOf = (v: unknown) => { const r = uuid.safeParse(v); if (!r.success) throw new HttpError(404, 'not_found'); return r.data; };

/** Online-only actions on an order: the customer's design files, pricing a delivery, and issuing its invoice number. */
export function adminOrdersRouter(deps: { orders: WebOrderService; invoices: InvoiceService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate);

  router.get('/:id/files', requirePermission('orders:read'), async (req, res) => {
    res.json(await deps.orders.listFiles(req.auth!, idOf(req.params.id)));
  });
  router.get('/:id/files/:fileId', requirePermission('orders:read'), async (req, res) => {
    const file = await deps.orders.fileForStaff(req.auth!, idOf(req.params.id), idOf(req.params.fileId));
    // Always a download, never shown inline: a customer's file is never rendered by the browser as a page.
    res.download(file.path, file.name, { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
  });
  router.post('/:id/delivery-fee', requirePermission('orders:delivery_fee:set'), async (req, res) => {
    const { fee } = parseWith(z.object({ fee: decimal }), req.body);
    res.json(await deps.orders.setDeliveryFee(req.auth!, idOf(req.params.id), fee));
  });
  router.post('/:id/invoice', requirePermission('orders:update'), async (req, res) => {
    res.json(await deps.invoices.issue(req.auth!, idOf(req.params.id)));
  });
  return router;
}
