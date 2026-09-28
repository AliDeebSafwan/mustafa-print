import type { Pool, PoolClient } from 'pg';
import { effectivePermissions, roleDefinition, type BranchSettingsInput, type StaffCreateInput, type StaffUpdateInput } from '@mpe/shared';
import { withTransaction } from '../../db/pool';
import { HttpError } from '../../http-error';
import type { AuthContext } from '../auth/types';
import { hashPassword, verifyPassword } from '../auth/password';
import { logAudit as log } from '../audit/audit';

type Row = Record<string, unknown>;

export interface StaffDeps { pool: Pool }

const PUBLIC_FIELDS = `id, full_name, email, phone_e164, locale, is_active, granted_permissions, last_login_at, created_at, row_version`;

function requireRole(key: string) {
  const role = roleDefinition(key);
  if (!role) throw new HttpError(400, 'invalid_request', `unknown role "${key}"`);
  return role;
}

/** A person's actual permissions right now — the number the owner sees on the team screen. */
function withEffective(row: Row) {
  const role = roleDefinition(String(row.role_key));
  return { ...row, permissions: role ? effectivePermissions(role, (row.granted_permissions as string[]) ?? []) : [] };
}

export type StaffService = ReturnType<typeof createStaffService>;

export function createStaffService({ pool }: StaffDeps) {
  // ---- the team --------------------------------------------------------------------------------------------------
  const listUsers = async (auth: AuthContext): Promise<Row[]> => {
    const { rows } = await pool.query<Row>(
      `SELECT u.${PUBLIC_FIELDS.replace(/, /g, ', u.')}, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.branch_id = $1 AND u.deleted_at IS NULL ORDER BY u.created_at`, [auth.branchId]);
    return rows.map(withEffective);
  };

  async function createUser(auth: AuthContext, input: StaffCreateInput & { role_key: string }): Promise<Row> {
    const role = requireRole(input.role_key);
    const hash = await hashPassword(input.password);
    try {
      const row = await withTransaction(pool, async (client) => {
        const { rows } = await client.query<Row>(
          `INSERT INTO users (branch_id, role_id, full_name, email, phone_e164, password_hash, locale, granted_permissions)
           SELECT $1, r.id, $2, $3, $4, $5, $6, $7 FROM roles r WHERE r.key = $8
           RETURNING ${PUBLIC_FIELDS}`,
          [auth.branchId, input.full_name, input.email ?? null, input.phone_e164 ?? null, hash, input.locale ?? 'ar', input.granted_permissions ?? [], role.key]);
        const created = rows[0]!;
        await log(client, auth, 'user.created', { type: 'user', id: String(created.id) }, { full_name: input.full_name, role: role.key });
        return created;
      });
      return { ...withEffective({ ...row, role_key: role.key }) };
    } catch (err) {
      if ((err as { code?: string; constraint?: string }).code === '23505') {
        throw new HttpError(409, 'invalid_request', /email/.test(String((err as { constraint?: string }).constraint)) ? 'email_in_use' : 'phone_in_use');
      }
      throw err;
    }
  }

  /** A branch must always keep at least one active admin, or nobody could ever manage it again. */
  async function assertNotLastAdmin(client: PoolClient, branchId: string, excludingUserId: string): Promise<void> {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.branch_id = $1 AND u.id != $2 AND u.is_active AND u.deleted_at IS NULL AND r.key = 'admin'`, [branchId, excludingUserId]);
    if (Number(rows[0]!.n) === 0) throw new HttpError(409, 'invalid_request', 'last_admin');
  }

  async function updateUser(auth: AuthContext, id: string, patch: StaffUpdateInput, expectedVersion: number): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row & { role_key: string }>(
        `SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.branch_id = $2 AND u.deleted_at IS NULL FOR UPDATE`,
        [id, auth.branchId]);
      const current = rows[0];
      if (!current) throw new HttpError(404, 'not_found');
      if (Number(current.row_version) !== expectedVersion) throw new HttpError(409, 'version_conflict', 'Someone saved a newer version meanwhile');

      const demoting = patch.role_key !== undefined && patch.role_key !== 'admin' && current.role_key === 'admin';
      const deactivating = patch.is_active === false && current.is_active;
      if (demoting || deactivating) await assertNotLastAdmin(client, auth.branchId, id);

      const role = patch.role_key ? requireRole(patch.role_key) : undefined;
      const { rows: saved } = await client.query<Row>(
        `UPDATE users SET full_name = coalesce($3, full_name), email = CASE WHEN $4 THEN $5 ELSE email END,
                phone_e164 = CASE WHEN $6 THEN $7 ELSE phone_e164 END, locale = coalesce($8, locale),
                role_id = coalesce((SELECT id FROM roles WHERE key = $9), role_id),
                granted_permissions = coalesce($10, granted_permissions), is_active = coalesce($11, is_active)
          WHERE id = $1 AND branch_id = $2 RETURNING ${PUBLIC_FIELDS}`,
        [id, auth.branchId, patch.full_name ?? null, 'email' in patch, patch.email ?? null, 'phone_e164' in patch, patch.phone_e164 ?? null,
         patch.locale ?? null, role?.key ?? null, patch.granted_permissions ?? null, patch.is_active ?? null]);

      if (role && role.key !== current.role_key) await log(client, auth, 'user.role_changed', { type: 'user', id }, { from: current.role_key, to: role.key });
      if (patch.granted_permissions) await log(client, auth, 'user.permissions_changed', { type: 'user', id }, { granted: patch.granted_permissions });
      if (patch.is_active === false) await log(client, auth, 'user.deactivated', { type: 'user', id });
      if (patch.is_active === true && !current.is_active) await log(client, auth, 'user.reactivated', { type: 'user', id });
      if (patch.full_name || 'email' in patch || 'phone_e164' in patch || patch.locale) await log(client, auth, 'user.updated', { type: 'user', id });

      return withEffective({ ...saved[0]!, role_key: role?.key ?? current.role_key });
    });
  }

  async function resetPassword(auth: AuthContext, id: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    await withTransaction(pool, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE users SET password_hash = $3, token_version = token_version + 1 WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL`,
        [id, auth.branchId, hash]);
      if (!rowCount) throw new HttpError(404, 'not_found');
      await log(client, auth, 'user.password_reset', { type: 'user', id });
    });
  }

  async function endSessions(auth: AuthContext, id: string): Promise<void> {
    await withTransaction(pool, async (client) => {
      const { rowCount } = await client.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL`, [id, auth.branchId]);
      if (!rowCount) throw new HttpError(404, 'not_found');
      await log(client, auth, 'user.sessions_ended', { type: 'user', id });
    });
  }

  // ---- the signed-in owner's own password ---------------------------------------------------------------------------
  /** Bumps token_version so every OTHER device is signed out; the route immediately reissues a session for THIS one. */
  async function changeMyPassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
    const { rows } = await pool.query<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', [auth.userId]);
    if (!(await verifyPassword(rows[0]?.password_hash, currentPassword))) throw new HttpError(401, 'invalid_credentials', 'Current password is wrong');
    const hash = await hashPassword(newPassword);
    await withTransaction(pool, async (client) => {
      await client.query('UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1', [auth.userId, hash]);
      await log(client, auth, 'my_password.changed', { type: 'user', id: auth.userId });
    });
  }

  // ---- the shop's business settings --------------------------------------------------------------------------------
  const BRANCH_FIELDS = `id, max_discount_percent::text, legal_name_ar, legal_name_en, tax_number, vat_enabled, vat_rate_percent::text, invoice_footer_ar, invoice_footer_en, deposit_percent::text, deposit_threshold::text, summary_email, summary_hour, row_version`;

  const getBranchSettings = async (auth: AuthContext): Promise<Row> =>
    (await pool.query<Row>(`SELECT ${BRANCH_FIELDS} FROM branches WHERE id = $1`, [auth.branchId])).rows[0]!;

  async function saveBranchSettings(auth: AuthContext, input: BranchSettingsInput, expectedVersion: number): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ row_version: number }>('SELECT row_version FROM branches WHERE id = $1 FOR UPDATE', [auth.branchId]);
      if (!rows[0]) throw new HttpError(404, 'not_found');
      if (rows[0].row_version !== expectedVersion) throw new HttpError(409, 'version_conflict', 'Someone saved a newer version meanwhile');
      // Only the fields the caller actually sent are changed; everything else — including fields other screens
      // never touch — keeps its current value. The discount-cap screen, for instance, sends only that one field.
      const { rows: saved } = await client.query<Row>(
        `UPDATE branches SET
                max_discount_percent = CASE WHEN $2  THEN $3  ELSE max_discount_percent END,
                legal_name_ar     = CASE WHEN $4  THEN $5  ELSE legal_name_ar     END,
                legal_name_en     = CASE WHEN $6  THEN $7  ELSE legal_name_en     END,
                tax_number        = CASE WHEN $8  THEN $9  ELSE tax_number        END,
                vat_enabled       = CASE WHEN $10 THEN $11 ELSE vat_enabled       END,
                vat_rate_percent  = CASE WHEN $12 THEN $13 ELSE vat_rate_percent  END,
                invoice_footer_ar = CASE WHEN $14 THEN $15 ELSE invoice_footer_ar END,
                invoice_footer_en = CASE WHEN $16 THEN $17 ELSE invoice_footer_en END,
                deposit_percent   = CASE WHEN $18 THEN $19 ELSE deposit_percent   END,
                deposit_threshold = CASE WHEN $20 THEN $21 ELSE deposit_threshold END,
                summary_email     = CASE WHEN $22 THEN $23 ELSE summary_email     END,
                summary_hour      = CASE WHEN $24 THEN $25 ELSE summary_hour      END
          WHERE id = $1 RETURNING ${BRANCH_FIELDS}`,
        [auth.branchId,
         'max_discount_percent' in input, input.max_discount_percent ?? null,
         'legal_name_ar' in input, input.legal_name_ar ?? null, 'legal_name_en' in input, input.legal_name_en ?? null,
         'tax_number' in input, input.tax_number ?? null, 'vat_enabled' in input, input.vat_enabled ?? null,
         'vat_rate_percent' in input, input.vat_rate_percent ?? null, 'invoice_footer_ar' in input, input.invoice_footer_ar ?? null,
         'invoice_footer_en' in input, input.invoice_footer_en ?? null,
         'deposit_percent' in input, input.deposit_percent ?? null, 'deposit_threshold' in input, input.deposit_threshold ?? null,
         'summary_email' in input, input.summary_email ?? null, 'summary_hour' in input, input.summary_hour ?? null]);
      await log(client, auth, 'branch_settings.updated', { type: 'branch', id: auth.branchId }, { changed: Object.keys(input) });
      return saved[0]!;
    });
  }

  // ---- the audit log ------------------------------------------------------------------------------------------------
  async function auditLog(auth: AuthContext, opts: { limit?: number; before?: string } = {}): Promise<Row[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const { rows } = await pool.query<Row>(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at, u.full_name AS actor_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.branch_id = $1 AND ($2::timestamptz IS NULL OR a.created_at < $2)
        ORDER BY a.created_at DESC LIMIT $3`,
      [auth.branchId, opts.before ?? null, limit]);
    return rows;
  }

  return { listUsers, createUser, updateUser, resetPassword, endSessions, changeMyPassword, getBranchSettings, saveBranchSettings, auditLog };
}
