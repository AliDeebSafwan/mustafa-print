import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { HttpError, parseWith } from '../http-error';
import { requirePermission } from '../modules/auth/middleware';
import { toCsv, type ReportsService } from '../modules/reports/reports.service';

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Read-only, online-only views of the shop's own data. `reports:read` is never in a role's default set and is not
 * delegable by default (it is on the owner's toggle list), so only an admin — or a staff member the owner
 * specifically trusted with it — ever reaches these.
 */
export function adminReportsRouter(deps: { reports: ReportsService; authenticate: RequestHandler }): Router {
  const router = Router();
  router.use(deps.authenticate, requirePermission('reports:read'));

  router.get('/dashboard', async (req, res) => {
    res.json(await deps.reports.dashboard(req.auth!, parseWith(dateQuery, req.query).date));
  });

  router.get('/unpaid', async (req, res) => {
    const rows = await deps.reports.unpaidBalances(req.auth!);
    if (req.query.format === 'csv') return sendCsv(res, 'unpaid-balances', rows,
      ['public_code', 'order_number', 'customer_name', 'customer_phone', 'placed_at', 'status', 'payment_status', 'total', 'paid_total', 'remaining', 'currency']);
    res.json(rows);
  });

  router.get('/cash-closing', async (req, res) => {
    const { date } = parseWith(dateQuery, req.query);
    const report = await deps.reports.cashClosing(req.auth!, date);
    if (req.query.format === 'csv') return sendCsv(res, `cash-closing-${date ?? 'today'}`, report.entries as Record<string, unknown>[],
      ['public_code', 'order_number', 'customer_name', 'txn_type', 'method', 'amount', 'till_at', 'handled_by_name', 'note']);
    res.json(report);
  });

  router.get('/production-queue', async (req, res) => {
    const rows = await deps.reports.productionQueue(req.auth!);
    if (req.query.format === 'csv') return sendCsv(res, 'production-queue', rows,
      ['public_code', 'order_number', 'customer_name', 'customer_phone', 'status', 'fulfillment_type', 'due_at', 'placed_at']);
    res.json(rows);
  });

  return router;
}

function sendCsv(res: Response, name: string, rows: Record<string, unknown>[], headers: string[]): void {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` });
  // A UTF-8 BOM: without it, Excel guesses the wrong encoding and Arabic names turn into mojibake.
  res.send('\uFEFF' + toCsv(headers, rows));
}
