import type { Pool } from 'pg';
import { withTransaction } from '../../db/pool';
import { HttpError } from '../../http-error';
import type { AuthContext } from '../auth/types';

type Row = Record<string, unknown>;

export type CompanyInvoiceService = ReturnType<typeof createCompanyInvoiceService>;

/**
 * One invoice for many of a company's orders — the monthly statement a business customer expects instead of one
 * paper per job. Its own gap-free series ('company_invoice'), and an order it covers can never also carry its own
 * individual invoice (enforced in the database: orders_invoiced_once).
 */
export function createCompanyInvoiceService({ pool }: { pool: Pool }) {
  /** Orders that can still go on a consolidated invoice: not cancelled, not invoiced either way yet. */
  async function unbilled(auth: AuthContext, customerId: string): Promise<Row[]> {
    const { rows } = await pool.query<Row>(
      `SELECT id, order_number::text, public_code, status, placed_at, currency, (total - tax_total)::text AS net, tax_total::text, total::text
         FROM orders
        WHERE customer_id = $1 AND branch_id = $2 AND deleted_at IS NULL AND status != 'cancelled'
          AND invoice_number IS NULL AND company_invoice_id IS NULL
        ORDER BY placed_at`, [customerId, auth.branchId]);
    return rows;
  }

  async function issue(auth: AuthContext, customerId: string, orderIds: string[]): Promise<Row> {
    const unique = [...new Set(orderIds)];
    return withTransaction(pool, async (client) => {
      const { rows: [customer] } = await client.query<{ customer_type: string }>(
        'SELECT customer_type FROM customers WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL', [customerId, auth.branchId]);
      if (!customer) throw new HttpError(404, 'not_found');
      if (customer.customer_type !== 'b2b') throw new HttpError(400, 'invalid_request', 'not_a_company');

      // Locked in a fixed order so two people issuing at once cannot deadlock, and neither can bill the same order.
      const { rows: orders } = await client.query<Row>(
        `SELECT id, customer_id, status, currency, invoice_number, company_invoice_id, total, tax_total
           FROM orders WHERE id = ANY($1::uuid[]) AND branch_id = $2 AND deleted_at IS NULL ORDER BY id FOR UPDATE`, [unique, auth.branchId]);
      if (orders.length !== unique.length) throw new HttpError(404, 'not_found', 'order');
      for (const o of orders) {
        if (o.customer_id !== customerId) throw new HttpError(400, 'invalid_request', 'order_of_another_customer');
        if (o.status === 'cancelled') throw new HttpError(400, 'invalid_request', 'order_cancelled');
        if (o.invoice_number || o.company_invoice_id) throw new HttpError(409, 'invalid_request', 'already_invoiced');
      }
      const currencies = new Set(orders.map((o) => o.currency));
      if (currencies.size > 1) throw new HttpError(400, 'invalid_request', 'mixed_currencies');

      const { rows: [invoice] } = await client.query<Row>(
        `INSERT INTO company_invoices (branch_id, customer_id, invoice_number, currency, subtotal, tax_total, total, order_count, issued_by)
         SELECT $1, $2, next_branch_counter($1, 'company_invoice'), $3, sum(total - tax_total), sum(tax_total), sum(total), count(*), $5
           FROM orders WHERE id = ANY($4::uuid[])
         RETURNING id`, [auth.branchId, customerId, [...currencies][0], unique, auth.userId]);
      await client.query('UPDATE orders SET company_invoice_id = $1 WHERE id = ANY($2::uuid[])', [invoice!.id, unique]);
      return read(client, auth, String(invoice!.id));
    });
  }

  async function read(q: { query: Pool['query'] }, auth: AuthContext, id: string): Promise<Row> {
    const { rows: [invoice] } = await q.query<Row>(
      `SELECT i.id, i.invoice_number::text, i.currency, i.subtotal::text, i.tax_total::text, i.total::text, i.order_count, i.issued_at,
              c.id AS customer_id, c.full_name, c.company_name, c.tax_number AS customer_tax_number, c.address_line, c.city,
              b.legal_name_ar, b.legal_name_en, b.name_ar, b.name_en, b.tax_number AS shop_tax_number, b.invoice_footer_ar, b.invoice_footer_en,
              b.vat_enabled, b.vat_rate_percent::text
         FROM company_invoices i JOIN customers c ON c.id = i.customer_id JOIN branches b ON b.id = i.branch_id
        WHERE i.id = $1 AND i.branch_id = $2`, [id, auth.branchId]);
    if (!invoice) throw new HttpError(404, 'not_found');
    const { rows: orders } = await q.query<Row>(
      `SELECT id, order_number::text, public_code, placed_at, (total - tax_total)::text AS net, tax_total::text, total::text
         FROM orders WHERE company_invoice_id = $1 ORDER BY placed_at`, [id]);
    return { ...invoice, orders };
  }

  async function list(auth: AuthContext, customerId: string): Promise<Row[]> {
    const { rows } = await pool.query<Row>(
      `SELECT id, invoice_number::text, currency, total::text, order_count, issued_at FROM company_invoices
        WHERE customer_id = $1 AND branch_id = $2 ORDER BY issued_at DESC`, [customerId, auth.branchId]);
    return rows;
  }

  return { unbilled, issue, get: (auth: AuthContext, id: string) => read(pool, auth, id), list };
}
