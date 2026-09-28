import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { discountExceedsCap, generatePublicCode, hasPermission, type PublicQuote, type quoteInput } from '@mpe/shared';
import type { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { HttpError } from '../../http-error';
import type { AuthContext } from '../auth/types';
import { enqueueOrderNotification } from '../messaging/enqueue';

type Row = Record<string, unknown>;

/** A quote nobody answered in time is expired; computed, never stored, so it cannot drift from the clock. */
const EFFECTIVE_STATUS = `CASE WHEN q.status = 'sent' AND q.valid_until < clock_timestamp() THEN 'expired' ELSE q.status END`;

export type QuotesService = ReturnType<typeof createQuotesService>;

export function createQuotesService({ pool, publicWebUrl }: { pool: Pool; publicWebUrl: string }) {
  // ---- staff side ---------------------------------------------------------------------------------------------------
  async function create(auth: AuthContext, input: z.output<typeof quoteInput>): Promise<Row> {
    const id = await withTransaction(pool, async (client) => {
      const customer = await client.query('SELECT 1 FROM customers WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL', [input.customer_id, auth.branchId]);
      if (!customer.rowCount) throw new HttpError(404, 'not_found', 'customer');

      // Checked before anything is written, so the person sees a clear reason rather than a database constraint error.
      const lineTotal = (l: typeof input.items[number]) => Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100 - Number(l.discount ?? 0);
      if (input.items.some((l) => lineTotal(l) < 0)) throw new HttpError(400, 'invalid_request', 'negative_line');

      const quoteId = randomUUID();
      await client.query(
        `INSERT INTO quotes (id, branch_id, quote_number, public_code, customer_id, currency, subtotal, discount_total, tax_total, total, valid_until, notes, internal_notes, created_by)
         VALUES ($1, $2, next_branch_counter($2, 'quote'), $3, $4, (SELECT base_currency FROM branches WHERE id = $2), 0, 0, 0, 0,
                 clock_timestamp() + make_interval(days => $5), $6, $7, $8)`,
        [quoteId, auth.branchId, generatePublicCode(), input.customer_id, input.valid_days, input.notes ?? null, input.internal_notes ?? null, auth.userId]);
      for (const [index, line] of input.items.entries()) {
        // The same exact-decimal line arithmetic as an order, so the order it becomes carries identical numbers.
        await client.query(
          `INSERT INTO quote_items (branch_id, quote_id, product_id, sort_order, name_snapshot, unit, quantity, unit_price, discount, line_total, notes)
           VALUES ($1, $2, $3, $4, $5, $6, round($7::numeric, 3), round($8::numeric, 4), round($9::numeric, 2),
                   round(round($7::numeric, 3) * round($8::numeric, 4), 2) - round($9::numeric, 2), $10)`,
          [auth.branchId, quoteId, line.product_id ?? null, index, line.name, line.unit ?? 'piece', line.quantity, line.unit_price, line.discount ?? '0', line.notes ?? null]);
      }
      const discountTotal = input.discount_total ?? '0';
      const { rows: [sums] } = await client.query<{ net: string; gross: string; given: string; cap: string | null }>(
        `SELECT coalesce(sum(line_total), 0)::text AS net,
                (coalesce(sum(line_total), 0) + coalesce(sum(discount), 0))::text AS gross,
                (coalesce(sum(discount), 0) + round($3::numeric, 2))::text AS given,
                (SELECT max_discount_percent::text FROM branches WHERE id = $2) AS cap
           FROM quote_items WHERE quote_id = $1`, [quoteId, auth.branchId, discountTotal]);
      if (Number(sums!.net) - Number(discountTotal) < 0) throw new HttpError(400, 'invalid_request', 'discount_exceeds_subtotal');
      if (!hasPermission(auth.role.permissions, 'orders:discount:override') &&
          discountExceedsCap(sums!.gross, sums!.given, sums!.cap === null ? null : Number(sums!.cap))) {
        throw new HttpError(400, 'invalid_request', `discount_too_large:${sums!.cap}`);
      }
      await client.query(
        `UPDATE quotes SET subtotal = $3::numeric, discount_total = round($4::numeric, 2),
                tax_total = branch_vat_amount($2, $3::numeric - round($4::numeric, 2)),
                total = $3::numeric - round($4::numeric, 2) + branch_vat_amount($2, $3::numeric - round($4::numeric, 2))
          WHERE id = $1`, [quoteId, auth.branchId, sums!.net, discountTotal]);
      return quoteId;
    });
    return detail(auth, id);
  }

  async function list(auth: AuthContext): Promise<Row[]> {
    const { rows } = await pool.query<Row>(
      `SELECT q.id, q.quote_number::text, q.public_code, ${EFFECTIVE_STATUS} AS status, q.total::text, q.currency, q.valid_until, q.created_at,
              c.full_name AS customer_name
         FROM quotes q JOIN customers c ON c.id = q.customer_id
        WHERE q.branch_id = $1 AND q.deleted_at IS NULL ORDER BY q.created_at DESC LIMIT 200`, [auth.branchId]);
    return rows;
  }

  async function detail(auth: AuthContext, id: string): Promise<Row> {
    const { rows } = await pool.query<Row>(
      `SELECT q.id, q.quote_number::text, q.public_code, ${EFFECTIVE_STATUS} AS status, q.currency, q.subtotal::text, q.discount_total::text,
              q.tax_total::text, q.total::text, q.valid_until, q.notes, q.internal_notes, q.decline_reason, q.order_id, q.accepted_at, q.created_at,
              q.customer_id, c.full_name AS customer_name, c.phone_e164 AS customer_phone
         FROM quotes q JOIN customers c ON c.id = q.customer_id
        WHERE q.id = $1 AND q.branch_id = $2 AND q.deleted_at IS NULL`, [id, auth.branchId]);
    if (!rows[0]) throw new HttpError(404, 'not_found');
    const items = (await pool.query<Row>(
      `SELECT name_snapshot AS name, quantity::text, unit_price::text, discount::text, line_total::text, notes
         FROM quote_items WHERE quote_id = $1 ORDER BY sort_order`, [id])).rows;
    return { ...rows[0], items, link: `${publicWebUrl}/ar/quote/${rows[0].public_code}` };
  }

  async function cancel(auth: AuthContext, id: string): Promise<Row> {
    const { rows } = await pool.query<Row>(
      `UPDATE quotes SET status = 'cancelled' WHERE id = $1 AND branch_id = $2 AND status = 'sent' AND deleted_at IS NULL RETURNING id`, [id, auth.branchId]);
    if (!rows[0]) throw new HttpError(409, 'invalid_request', 'quote_not_open');
    return detail(auth, id);
  }

  // ---- the customer's link -------------------------------------------------------------------------------------------
  async function view(code: string): Promise<PublicQuote> {
    const { rows } = await pool.query<Row & { id: string }>(
      `SELECT q.id, q.quote_number::text AS number, ${EFFECTIVE_STATUS} AS status, c.full_name AS customer_name, b.name_ar, b.name_en, q.currency,
              q.subtotal::text, q.discount_total::text, q.tax_total::text, q.total::text, q.valid_until, q.notes, o.public_code AS order_code
         FROM quotes q JOIN customers c ON c.id = q.customer_id JOIN branches b ON b.id = q.branch_id
         LEFT JOIN orders o ON o.id = q.order_id
        WHERE q.public_code = $1 AND q.deleted_at IS NULL`, [code]);
    const q = rows[0];
    if (!q) throw new HttpError(404, 'not_found');
    const items = (await pool.query<{ name: string; quantity: string; unit_price: string; line_total: string }>(
      `SELECT name_snapshot AS name, quantity::text, unit_price::text, line_total::text FROM quote_items WHERE quote_id = $1 ORDER BY sort_order`, [q.id])).rows;
    return {
      number: String(q.number), status: q.status as PublicQuote['status'], customerName: String(q.customer_name),
      shopNameAr: String(q.name_ar), shopNameEn: String(q.name_en), currency: String(q.currency),
      subtotal: String(q.subtotal), discountTotal: String(q.discount_total), taxTotal: String(q.tax_total), total: String(q.total),
      validUntil: new Date(q.valid_until as string).toISOString(), notes: (q.notes as string | null) ?? null,
      items: items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unit_price, lineTotal: i.line_total })),
      orderCode: (q.order_code as string | null) ?? null,
    };
  }

  /** Accepting twice (a double tap, a second tab) returns the same order: the first acceptance is the only one. */
  async function accept(code: string): Promise<{ orderCode: string }> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row & { id: string; branch_id: string; order_id: string | null; quote_number: string }>(
        `SELECT q.*, q.quote_number::text, ${EFFECTIVE_STATUS} AS effective FROM quotes q WHERE q.public_code = $1 AND q.deleted_at IS NULL FOR UPDATE`, [code]);
      const q = rows[0];
      if (!q) throw new HttpError(404, 'not_found');
      if (q.status === 'accepted') {
        const { rows: [o] } = await client.query<{ public_code: string }>('SELECT public_code FROM orders WHERE id = $1', [q.order_id]);
        return { orderCode: o!.public_code };
      }
      if (q.effective !== 'sent') throw new HttpError(409, 'invalid_request', `quote_${q.effective}`);

      const orderId = randomUUID();
      const orderCode = generatePublicCode();
      await client.query(
        `INSERT INTO orders (id, branch_id, public_code, customer_id, source, status, fulfillment_type, payment_method, currency,
                             subtotal, discount_total, delivery_fee, tax_total, total, customer_notes, internal_notes)
         VALUES ($1, $2, $3, $4, 'quote', 'received', 'pickup', 'cash', $5, $6, $7, 0, $8, $9, $10, $11)`,
        [orderId, q.branch_id, orderCode, q.customer_id, q.currency, q.subtotal, q.discount_total, q.tax_total, q.total,
         q.notes ?? null, `Accepted quote #${q.quote_number}`]);
      await client.query(
        `INSERT INTO order_items (id, branch_id, order_id, product_id, sort_order, name_snapshot, unit, quantity, unit_price, discount, line_total, notes)
         SELECT gen_random_uuid(), branch_id, $2, product_id, sort_order, name_snapshot, unit, quantity, unit_price, discount, line_total, notes
           FROM quote_items WHERE quote_id = $1`, [q.id, orderId]);
      await client.query(`INSERT INTO barcodes (branch_id, order_id, label_type, code, symbology) VALUES ($1, $2, 'order', $3, 'qr')`, [q.branch_id, orderId, orderCode]);
      await client.query(
        `INSERT INTO order_status_history (branch_id, order_id, from_status, to_status, source, note) VALUES ($1, $2, NULL, 'received', 'web', $3)`,
        [q.branch_id, orderId, `accepted quote #${q.quote_number}`]);
      await client.query(`UPDATE quotes SET status = 'accepted', order_id = $2, accepted_at = clock_timestamp() WHERE id = $1`, [q.id, orderId]);
      await enqueueOrderNotification(client, orderId, 'received', { publicWebUrl });
      return { orderCode };
    });
  }

  async function decline(code: string, reason: string | undefined): Promise<void> {
    const { rows } = await pool.query(
      `UPDATE quotes q SET status = 'declined', decline_reason = $2
        WHERE q.public_code = $1 AND q.status = 'sent' AND q.valid_until >= clock_timestamp() AND q.deleted_at IS NULL RETURNING id`,
      [code, reason?.trim().slice(0, 1000) || null]);
    if (!rows[0]) throw new HttpError(409, 'invalid_request', 'quote_not_open');
  }

  return { create, list, detail, cancel, view, accept, decline };
}
