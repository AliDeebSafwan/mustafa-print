import type { Pool } from 'pg';
import { withTransaction } from '../../db/pool';
import { HttpError } from '../../http-error';
import { logAudit } from '../audit/audit';
import type { AuthContext } from '../auth/types';
import { createCustomerForAccount } from './customer-auth.service';

type Row = Record<string, unknown>;

export type CustomerAccountsAdminService = ReturnType<typeof createCustomerAccountsAdminService>;

/**
 * The owner's view of website accounts. Online only, like the other owner tools: an account is not a customer
 * record and is never synced to staff devices.
 */
export function createCustomerAccountsAdminService({ pool }: { pool: Pool }) {
  async function list(auth: AuthContext, query = ''): Promise<Row[]> {
    const q = query.trim().toLowerCase();
    const { rows } = await pool.query<Row>(
      `SELECT a.id, a.email, a.full_name, a.phone_e164, a.is_active, a.email_verified_at, a.created_at, a.row_version,
              a.customer_id, c.full_name AS customer_name,
              (SELECT count(*)::int FROM orders o WHERE o.customer_id = a.customer_id AND o.deleted_at IS NULL) AS order_count
         FROM customer_accounts a LEFT JOIN customers c ON c.id = a.customer_id
        WHERE a.branch_id = $1 AND a.deleted_at IS NULL
          AND ($2 = '' OR a.email LIKE '%' || $2 || '%' OR lower(a.full_name) LIKE '%' || $2 || '%' OR coalesce(a.phone_e164, '') LIKE '%' || $2 || '%')
        ORDER BY a.created_at DESC LIMIT 200`,
      [auth.branchId, q]);
    return rows;
  }

  async function detail(auth: AuthContext, id: string): Promise<Row> {
    const { rows } = await pool.query<Row>(
      `SELECT a.id, a.email, a.full_name, a.phone_e164, a.locale, a.is_active, a.email_verified_at, a.created_at, a.row_version,
              a.customer_id, c.full_name AS customer_name, c.phone_e164 AS customer_phone
         FROM customer_accounts a LEFT JOIN customers c ON c.id = a.customer_id
        WHERE a.id = $1 AND a.branch_id = $2 AND a.deleted_at IS NULL`, [id, auth.branchId]);
    const account = rows[0];
    if (!account) throw new HttpError(404, 'not_found');

    const orders = account.customer_id ? (await pool.query<Row>(
      `SELECT id, public_code, order_number::text, status, total::text, currency, placed_at
         FROM orders WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY placed_at DESC LIMIT 50`, [account.customer_id])).rows : [];

    // Likely duplicates the owner may want to merge into: counter customers sharing the phone the person typed, or the
    // same name, and not already tied to another website account. A suggestion only; the owner decides.
    const candidates = account.customer_id ? (await pool.query<Row>(
      `SELECT c.id, c.full_name, c.phone_e164, c.email,
              (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id AND o.deleted_at IS NULL) AS order_count
         FROM customers c
        WHERE c.branch_id = $1 AND c.deleted_at IS NULL AND c.id != $2
          AND NOT EXISTS (SELECT 1 FROM customer_accounts x WHERE x.customer_id = c.id AND x.deleted_at IS NULL)
          AND ((c.phone_e164 IS NOT NULL AND c.phone_e164 = $3) OR lower(trim(c.full_name)) = lower(trim($4)))
        ORDER BY (c.phone_e164 = $3) DESC NULLS LAST, c.updated_at DESC LIMIT 10`,
      [auth.branchId, account.customer_id, account.phone_e164, account.full_name])).rows : [];

    return { ...account, orders, candidates };
  }

  async function setActive(auth: AuthContext, id: string, active: boolean): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row>(
        `UPDATE customer_accounts SET is_active = $3 WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL
         RETURNING id, is_active, row_version`, [id, auth.branchId, active]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      // Signed out everywhere at once, not merely refused on the next request.
      if (!active) await client.query('DELETE FROM customer_sessions WHERE account_id = $1', [id]);
      await logAudit(client, auth, active ? 'customer_account.reactivated' : 'customer_account.deactivated', { type: 'customer_account', id });
      return rows[0];
    });
  }

  /**
   * The owner vouches for an account whose email is not confirmed yet (the person is known to the shop, or the email
   * never arrived): it may order from now on, exactly as if the link had been opened. The confirmation link keeps working.
   *
   * Unlike a confirmed email, the owner's approval does not prove who owns the address, so the account always gets a
   * new customer record and is never tied automatically to a counter customer with the same email: that would show
   * their order history to whoever typed their address. If it is the same person, the owner merges the two below.
   */
  async function approve(auth: AuthContext, id: string): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ id: string; branch_id: string; full_name: string; email: string; phone_e164: string | null;
                                             locale: 'ar' | 'en'; customer_id: string | null; email_verified_at: Date | null }>(
        'SELECT * FROM customer_accounts WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, auth.branchId]);
      const account = rows[0];
      if (!account) throw new HttpError(404, 'not_found');
      if (account.email_verified_at) throw new HttpError(409, 'invalid_request', 'already_verified');

      const customerId = account.customer_id ?? await createCustomerForAccount(client, account);
      const updated = await client.query<Row>(
        `UPDATE customer_accounts SET email_verified_at = clock_timestamp(), customer_id = $2 WHERE id = $1
         RETURNING id, email_verified_at, customer_id, row_version`, [id, customerId]);
      await logAudit(client, auth, 'customer_account.approved', { type: 'customer_account', id }, { customer_id: customerId });
      return updated.rows[0]!;
    });
  }

  /**
   * The person who signed up on the website is the same person already registered at the counter: point the account at
   * the counter record, move everything that belonged to the duplicate over to it, and retire the duplicate. Their
   * whole history ends up in one place, on the counter record staff already know.
   */
  async function merge(auth: AuthContext, id: string, targetCustomerId: string): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row & { customer_id: string | null; email: string }>(
        'SELECT * FROM customer_accounts WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, auth.branchId]);
      const account = rows[0];
      if (!account) throw new HttpError(404, 'not_found');
      const source = account.customer_id;
      if (!source) throw new HttpError(400, 'invalid_request', 'not_verified');
      if (source === targetCustomerId) throw new HttpError(400, 'invalid_request', 'same_customer');

      const target = (await client.query<{ id: string; email: string | null }>(
        'SELECT id, email FROM customers WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [targetCustomerId, auth.branchId])).rows[0];
      if (!target) throw new HttpError(404, 'not_found');
      const taken = await client.query('SELECT 1 FROM customer_accounts WHERE customer_id = $1 AND id != $2 AND deleted_at IS NULL', [targetCustomerId, id]);
      if (taken.rowCount) throw new HttpError(409, 'invalid_request', 'target_has_account');

      const moved = await client.query('UPDATE orders SET customer_id = $2 WHERE customer_id = $1 AND branch_id = $3', [source, targetCustomerId, auth.branchId]);
      await client.query('UPDATE transactions SET customer_id = $2 WHERE customer_id = $1 AND branch_id = $3', [source, targetCustomerId, auth.branchId]);
      await client.query('UPDATE notification_logs SET customer_id = $2 WHERE customer_id = $1 AND branch_id = $3', [source, targetCustomerId, auth.branchId]);

      // Retire the duplicate first, so nothing it holds can collide with the counter record it is merging into.
      await client.query('UPDATE customers SET deleted_at = clock_timestamp() WHERE id = $1', [source]);
      await client.query('UPDATE customer_accounts SET customer_id = $2 WHERE id = $1', [id, targetCustomerId]);
      if (!target.email) {
        // The account's email is verified and the person agreed to email updates when ordering online; carry both over.
        await client.query(
          `UPDATE customers SET email = $2, email_opt_in = true,
                  consent_source = coalesce(consent_source, 'checkout'), consent_recorded_at = coalesce(consent_recorded_at, clock_timestamp())
            WHERE id = $1`, [targetCustomerId, account.email]);
      }

      await logAudit(client, auth, 'customer_account.merged', { type: 'customer_account', id },
        { from_customer: source, to_customer: targetCustomerId, orders_moved: moved.rowCount ?? 0 });
      return { id, customer_id: targetCustomerId, orders_moved: moved.rowCount ?? 0 };
    });
  }

  return { list, detail, setActive, approve, merge };
}
