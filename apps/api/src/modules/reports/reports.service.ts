import type { Pool } from 'pg';
/** Every report here only ever needs to know WHICH branch — so the worker's daily summary can ask the same questions
 *  without a signed-in person behind them. */
type BranchScope = { branchId: string };

type Row = Record<string, unknown>;

export interface ReportsDeps { pool: Pool }

/** Local YYYY-MM-DD, or undefined to mean "today" in the branch's own timezone. */
const isValidDate = (d: string | undefined): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d));

/**
 * The instant money actually lands in the shop's till: for cash paid at the counter that is the moment it was
 * collected; for a cash-on-delivery sale it is not until the cash is handed over and settled — before that it is
 * cash in someone's pocket, not the shop's drawer. Reused everywhere "today's cash" is computed, so the dashboard
 * and the till-closing report can never disagree about what counts.
 */
const TILL_DATE = `(CASE WHEN t.method = 'cod' THEN t.settled_at ELSE t.collected_at END)`;
const TILL_READY = `(t.method != 'cod' OR t.settled_at IS NOT NULL)`;

export type ReportsService = ReturnType<typeof createReportsService>;

/**
 * Every report reads real time in the SHOP'S OWN timezone (`branches.timezone`), not the server's or UTC: "today"
 * for a shop in Beirut must mean the day as the person standing at the counter experiences it. All of this is
 * online-only — a live view of the database, not something a device keeps a copy of.
 */
export function createReportsService({ pool }: ReportsDeps) {
  /** The UTC instant that is local midnight on `date` (or today) in the branch's timezone, and the same for the
   *  instant right after. Used as `[dayStart, dayEnd)` in every date-scoped query below. */
  async function dayRange(branchId: string, date?: string): Promise<{ start: string; end: string }> {
    const { rows } = await pool.query<{ start: string; end: string }>(
      `SELECT
         (coalesce($2::date, (now() AT TIME ZONE b.timezone)::date)::timestamp AT TIME ZONE b.timezone)::text AS start,
         (coalesce($2::date, (now() AT TIME ZONE b.timezone)::date)::timestamp AT TIME ZONE b.timezone + interval '1 day')::text AS "end"
       FROM branches b WHERE b.id = $1`,
      [branchId, isValidDate(date) ? date : null]);
    return rows[0]!;
  }

  // ---- today's dashboard --------------------------------------------------------------------------------------
  async function dashboard(auth: BranchScope, date?: string): Promise<Row> {
    const { start, end } = await dayRange(auth.branchId, date);
    const [placed, completed, collected, dueToday] = await Promise.all([
      pool.query<Row>(
        `SELECT count(*)::int AS orders, coalesce(sum(total), 0)::text AS revenue
           FROM orders WHERE branch_id = $1 AND placed_at >= $2 AND placed_at < $3 AND deleted_at IS NULL`,
        [auth.branchId, start, end]),
      pool.query<Row>(
        `SELECT count(*)::int AS orders FROM orders
          WHERE branch_id = $1 AND status = 'delivered' AND completed_at >= $2 AND completed_at < $3 AND deleted_at IS NULL`,
        [auth.branchId, start, end]),
      pool.query<Row>(
        `SELECT coalesce(sum(t.amount) FILTER (WHERE t.txn_type = 'payment'), 0)::text AS payments,
                coalesce(sum(t.amount) FILTER (WHERE t.txn_type = 'refund'), 0)::text  AS refunds
           FROM transactions t
          WHERE t.branch_id = $1 AND t.status = 'completed' AND ${TILL_READY} AND ${TILL_DATE} >= $2 AND ${TILL_DATE} < $3`,
        [auth.branchId, start, end]),
      pool.query<Row>(
        `SELECT count(*)::int AS orders FROM orders
          WHERE branch_id = $1 AND due_at >= $2 AND due_at < $3 AND status NOT IN ('delivered', 'cancelled') AND deleted_at IS NULL`,
        [auth.branchId, start, end]),
    ]);
    return {
      rangeStart: start, rangeEnd: end,
      ordersPlaced: placed.rows[0]!.orders, revenuePlaced: placed.rows[0]!.revenue,
      ordersCompleted: completed.rows[0]!.orders,
      cashIn: collected.rows[0]!.payments, cashOut: collected.rows[0]!.refunds,
      ordersDueToday: dueToday.rows[0]!.orders,
    };
  }

  // ---- unpaid balances (الذمم) ---------------------------------------------------------------------------------
  async function unpaidBalances(auth: BranchScope): Promise<Row[]> {
    const { rows } = await pool.query<Row>(
      `SELECT o.id, o.public_code, o.order_number::text, o.placed_at, o.status, o.payment_status, o.currency,
              o.total::text, o.paid_total::text, (o.total - o.paid_total)::text AS remaining,
              c.full_name AS customer_name, c.phone_e164 AS customer_phone
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.branch_id = $1 AND o.payment_status IN ('unpaid', 'partial') AND o.status != 'cancelled' AND o.deleted_at IS NULL
        ORDER BY o.placed_at`,
      [auth.branchId]);
    return rows;
  }

  // ---- closing the till for a day -------------------------------------------------------------------------------
  async function cashClosing(auth: BranchScope, date?: string): Promise<Row> {
    const { start, end } = await dayRange(auth.branchId, date);
    const [byMethod, entries] = await Promise.all([
      pool.query<Row>(
        `SELECT t.method, t.txn_type, coalesce(sum(t.amount), 0)::text AS amount, count(*)::int AS count
           FROM transactions t
          WHERE t.branch_id = $1 AND t.status = 'completed' AND ${TILL_READY} AND ${TILL_DATE} >= $2 AND ${TILL_DATE} < $3
          GROUP BY t.method, t.txn_type ORDER BY t.method, t.txn_type`,
        [auth.branchId, start, end]),
      pool.query<Row>(
        `SELECT t.id, t.txn_type, t.method, t.amount::text, ${TILL_DATE} AS till_at, t.note, o.public_code, o.order_number::text,
                c.full_name AS customer_name, coalesce(settler.full_name, collector.full_name) AS handled_by_name
           FROM transactions t JOIN orders o ON o.id = t.order_id JOIN customers c ON c.id = o.customer_id
           LEFT JOIN users collector ON collector.id = t.collected_by
           LEFT JOIN users settler ON settler.id = t.settled_by
          WHERE t.branch_id = $1 AND t.status = 'completed' AND ${TILL_READY} AND ${TILL_DATE} >= $2 AND ${TILL_DATE} < $3
          ORDER BY till_at`,
        [auth.branchId, start, end]),
    ]);
    return { rangeStart: start, rangeEnd: end, byMethod: byMethod.rows, entries: entries.rows };
  }

  // ---- the production queue: everything not yet closed out ------------------------------------------------------
  async function productionQueue(auth: BranchScope): Promise<Row[]> {
    const { rows } = await pool.query<Row>(
      `SELECT o.id, o.public_code, o.order_number::text, o.status, o.due_at, o.placed_at, o.fulfillment_type,
              c.full_name AS customer_name, c.phone_e164 AS customer_phone
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.branch_id = $1 AND o.status NOT IN ('delivered', 'cancelled') AND o.deleted_at IS NULL
        ORDER BY (o.due_at IS NULL), o.due_at, o.placed_at`,
      [auth.branchId]);
    return rows;
  }

  return { dashboard, unpaidBalances, cashClosing, productionQueue };
}

// ---- CSV, shared by every export endpoint ------------------------------------------------------------------------
/** Minimal, correct CSV: quotes a field only when it needs it, doubles internal quotes, uses CRLF (the RFC 4180 way
 *  Excel expects). Never trust field content — a customer's name or note can contain commas or quotes. */
export function toCsv(headers: string[], rows: Row[]): string {
  const cell = (value: unknown): string => {
    let s = value === null || value === undefined ? '' : String(value);
    // A customer's name like =HYPERLINK(...) would run as a formula when the owner opens this in Excel. Anything that
    // starts like a formula is forced to text with a leading apostrophe; a plain number (a -15.00 refund) is left as is.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(cell).join(','), ...rows.map((row) => headers.map((h) => cell(row[h])).join(','))];
  return lines.join('\r\n') + '\r\n';
}
