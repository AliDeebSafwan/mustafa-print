import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { PUBLIC_CODE_RE } from '@mpe/shared';

/** Unauthenticated endpoints for the customer website. The tracking code is a bearer secret (60 bits). */
export function publicRouter(pool: Pool): Router {
  const r = Router();
  r.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));

  r.get('/orders/:code', async (req, res) => {
    const code = String(req.params.code ?? '').toUpperCase();
    if (!PUBLIC_CODE_RE.test(code)) return void res.status(404).json({ error: 'not_found' });

    const { rows } = await pool.query(
      `SELECT o.id, o.order_number::text AS order_number, o.status, o.fulfillment_type, o.payment_status, o.payment_method,
              o.total::text AS total, o.currency, o.placed_at, o.due_at, o.delivery_fee_pending, b.name_ar AS branch_name_ar, b.name_en AS branch_name_en
         FROM orders o JOIN branches b ON b.id = o.branch_id
        WHERE o.public_code = $1 AND o.deleted_at IS NULL`,
      [code],
    );
    const order = rows[0];
    if (!order) return void res.status(404).json({ error: 'not_found' });

    const [timeline, items] = await Promise.all([
      pool.query(`SELECT to_status AS status, occurred_at FROM order_status_history WHERE order_id = $1 ORDER BY occurred_at`, [order.id]),
      pool.query(`SELECT name_snapshot AS name, quantity::text AS quantity, unit FROM order_items WHERE order_id = $1 AND deleted_at IS NULL ORDER BY sort_order`, [order.id]),
    ]);

    const { id: _internalId, ...publicOrder } = order;
    res.json({ order: publicOrder, timeline: timeline.rows, items: items.rows });
  });

  return r;
}
