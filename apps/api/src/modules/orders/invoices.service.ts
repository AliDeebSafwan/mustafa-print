import type { Pool } from 'pg';
import { withTransaction } from '../../db/pool';
import { HttpError } from '../../http-error';
import type { AuthContext } from '../auth/types';

type Row = Record<string, unknown>;

export type InvoiceService = ReturnType<typeof createInvoiceService>;

/**
 * Invoices get their own gap-free number (next_branch_counter, 'invoice'), separate from the order number: a
 * cancelled order never consumes one, and printing the same order's invoice again reuses the number it already has
 * instead of issuing a new one — the whole point of a gap-free sequence is that it never grows for the same sale twice.
 */
export function createInvoiceService({ pool }: { pool: Pool }) {
  async function issue(auth: AuthContext, orderId: string): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row>(
        'SELECT * FROM orders WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [orderId, auth.branchId]);
      const order = rows[0];
      if (!order) throw new HttpError(404, 'not_found');
      if (order.status === 'cancelled') throw new HttpError(400, 'invalid_request', 'order_cancelled');
      if (order.invoice_number) return order;
      // Already billed on a company's consolidated invoice: a second invoice for the same sale is never issued.
      if (order.company_invoice_id) throw new HttpError(409, 'invalid_request', 'on_company_invoice');
      const { rows: saved } = await client.query<Row>(
        `UPDATE orders SET invoice_number = next_branch_counter($2, 'invoice'), invoice_issued_at = clock_timestamp()
          WHERE id = $1 RETURNING *`, [orderId, auth.branchId]);
      return saved[0]!;
    });
  }

  return { issue };
}
