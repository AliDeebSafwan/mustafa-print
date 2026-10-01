import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { effectivePermissions, roleDefinition, type LoginRequest, type SessionBranch, type SessionResponse, type SessionUser } from '@mpe/shared';
import { withTransaction, type Queryable } from '../../db/pool';
import { HttpError } from '../../http-error';
import { normalizeIdentifier } from './identifier';
import { verifyPassword } from './password';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens';
import type { AuthConfig } from './types';

interface UserRow {
  id: string; branch_id: string; full_name: string; locale: 'ar' | 'en'; password_hash: string | null;
  is_active: boolean; token_version: number; role_key: string; granted_permissions: string[];
  branch_name_ar: string; branch_name_en: string; base_currency: string; max_discount_percent: string | null;
  legal_name_ar: string | null; legal_name_en: string | null; tax_number: string | null;
  vat_enabled: boolean; vat_rate_percent: string; invoice_footer_ar: string | null; invoice_footer_en: string | null;
  deposit_percent: string; deposit_threshold: string | null;
}
interface TokenRow {
  id: string; family_id: string; user_id: string; token_version: number; expired: boolean;
  revoked_at: Date | null; replaced_by: string | null; revoked_seconds_ago: string | null;
}
export interface IssuedSession { session: SessionResponse; refreshToken: string; refreshTokenId: string }

const USER_SELECT = `SELECT u.id, u.branch_id, u.full_name, u.locale, u.password_hash, u.is_active, u.token_version, u.granted_permissions, r.key AS role_key,
                            b.name_ar AS branch_name_ar, b.name_en AS branch_name_en, b.base_currency, b.max_discount_percent::text,
                            b.legal_name_ar, b.legal_name_en, b.tax_number, b.vat_enabled, b.vat_rate_percent::text, b.invoice_footer_ar, b.invoice_footer_en,
                            b.deposit_percent::text, b.deposit_threshold::text
                       FROM users u JOIN roles r ON r.id = u.role_id JOIN branches b ON b.id = u.branch_id`;

const toSessionBranch = (user: UserRow): SessionBranch => ({
  id: user.branch_id, nameAr: user.branch_name_ar, nameEn: user.branch_name_en, baseCurrency: user.base_currency,
  maxDiscountPercent: user.max_discount_percent === null ? null : Number(user.max_discount_percent),
  legalNameAr: user.legal_name_ar, legalNameEn: user.legal_name_en, taxNumber: user.tax_number,
  vatEnabled: user.vat_enabled, vatRatePercent: Number(user.vat_rate_percent),
  invoiceFooterAr: user.invoice_footer_ar, invoiceFooterEn: user.invoice_footer_en,
  depositPercent: Number(user.deposit_percent), depositThreshold: user.deposit_threshold === null ? null : Number(user.deposit_threshold),
});

function toSessionUser(user: UserRow): SessionUser {
  const role = roleDefinition(user.role_key);
  if (!role) throw new HttpError(403, 'forbidden', `Unknown role "${user.role_key}"`);
  return { id: user.id, fullName: user.full_name, role: role.key, branchId: user.branch_id, locale: user.locale, permissions: [...effectivePermissions(role, user.granted_permissions)] };
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService({ pool, cfg }: { pool: Pool; cfg: AuthConfig }) {
  // ---- login throttling (keyed by identifier, so unknown accounts behave exactly like real ones) ----
  async function assertNotLocked(key: string): Promise<void> {
    const { rows } = await pool.query<{ retry_after: string }>(
      `SELECT ceil(extract(epoch FROM locked_until - clock_timestamp()))::int AS retry_after
         FROM login_failures WHERE identifier = $1 AND locked_until > clock_timestamp()`, [key]);
    if (rows[0]) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Try again later.', { 'Retry-After': String(rows[0].retry_after) });
  }
  const recordFailure = (key: string) => pool.query(
    `INSERT INTO login_failures (identifier, failed_count) VALUES ($1, 1)
     ON CONFLICT (identifier) DO UPDATE
        SET failed_count = login_failures.failed_count + 1,
            locked_until = CASE WHEN login_failures.failed_count + 1 >= $2 THEN clock_timestamp() + make_interval(mins => $3)
                                ELSE login_failures.locked_until END,
            updated_at = clock_timestamp()`, [key, cfg.maxFailedLogins, cfg.lockMinutes]);
  const clearFailures = (key: string) => pool.query('DELETE FROM login_failures WHERE identifier = $1', [key]);

  // ---- sessions ----
  async function issueSession(q: Queryable, user: UserRow, opts: { familyId: string; userAgent?: string }): Promise<IssuedSession> {
    const sessionUser = toSessionUser(user);
    const refreshToken = generateRefreshToken();
    const refreshTokenId = randomUUID();
    await q.query(
      `INSERT INTO refresh_tokens (id, family_id, user_id, token_hash, token_version, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + make_interval(days => $7))`,
      [refreshTokenId, opts.familyId, user.id, hashRefreshToken(refreshToken), user.token_version, opts.userAgent?.slice(0, 300) ?? null, cfg.refreshTtlDays]);
    const accessToken = await signAccessToken(cfg, { userId: user.id, branchId: user.branch_id, role: user.role_key, tokenVersion: user.token_version });
    return { session: { accessToken, expiresIn: cfg.accessTtlSeconds, user: sessionUser, branch: toSessionBranch(user) }, refreshToken, refreshTokenId };
  }

  const revokeFamily = (q: Queryable, familyId: string) =>
    q.query('UPDATE refresh_tokens SET revoked_at = coalesce(revoked_at, clock_timestamp()) WHERE family_id = $1', [familyId]);

  async function login(input: LoginRequest, meta: { userAgent?: string } = {}): Promise<IssuedSession> {
    const identifier = normalizeIdentifier(input.identifier, cfg.defaultCallingCode);
    const throttleKey = identifier ?? input.identifier.trim().toLowerCase().slice(0, 254);
    await assertNotLocked(throttleKey);

    const { rows } = identifier
      ? await pool.query<UserRow>(`${USER_SELECT} WHERE u.deleted_at IS NULL AND (lower(u.email) = $1 OR u.phone_e164 = $1)`, [identifier])
      : { rows: [] as UserRow[] };
    const user = rows[0];
    const passwordMatches = await verifyPassword(user?.password_hash, input.password);   // runs even when the user is unknown

    if (!user || !passwordMatches || !user.is_active) {
      await recordFailure(throttleKey);
      throw new HttpError(401, 'invalid_credentials', 'Invalid identifier or password');
    }
    await clearFailures(throttleKey);
    return issueSession(pool, user, { familyId: randomUUID(), userAgent: meta.userAgent });
  }

  /**
   * A fresh session for a user who is already known to be who they say they are — used right after the owner
   * changes their own password, so that one action, not another login, is what keeps their current device working.
   */
  async function reissueSession(userId: string, meta: { userAgent?: string } = {}): Promise<IssuedSession> {
    const { rows } = await pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active`, [userId]);
    if (!rows[0]) throw new HttpError(401, 'invalid_token', 'Session is no longer valid');
    return issueSession(pool, rows[0], { familyId: randomUUID(), userAgent: meta.userAgent });
  }

  /** Rotates the refresh token. A rotated token shown again after the grace window means theft: the whole family dies. */
  async function refresh(rawToken: string | undefined, meta: { userAgent?: string } = {}): Promise<IssuedSession> {
    if (!rawToken) throw new HttpError(401, 'invalid_refresh');

    const outcome = await withTransaction(pool, async (client) => {
      const { rows } = await client.query<TokenRow>(
        `SELECT id, family_id, user_id, token_version, expires_at < clock_timestamp() AS expired, revoked_at, replaced_by,
                extract(epoch FROM clock_timestamp() - revoked_at)::text AS revoked_seconds_ago
           FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`, [hashRefreshToken(rawToken)]);
      const token = rows[0];
      if (!token) return { kind: 'invalid' } as const;

      if (token.revoked_at) {
        const rotatedJustNow = token.replaced_by !== null && Number(token.revoked_seconds_ago) <= cfg.refreshGraceSeconds;
        if (rotatedJustNow) return { kind: 'race' } as const;
        await revokeFamily(client, token.family_id);            // committed below because we return instead of throwing
        return { kind: 'reuse' } as const;
      }
      if (token.expired) return { kind: 'invalid' } as const;

      const user = (await client.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL`, [token.user_id])).rows[0];
      if (!user || !user.is_active || user.token_version !== token.token_version) {
        await revokeFamily(client, token.family_id);
        return { kind: 'invalid' } as const;
      }
      const issued = await issueSession(client, user, { familyId: token.family_id, userAgent: meta.userAgent });
      await client.query('UPDATE refresh_tokens SET revoked_at = clock_timestamp(), replaced_by = $2 WHERE id = $1', [token.id, issued.refreshTokenId]);
      return { kind: 'ok', issued } as const;
    });

    if (outcome.kind === 'ok') return outcome.issued;
    if (outcome.kind === 'race') throw new HttpError(401, 'refresh_race', 'Refresh token was just rotated; retry with the new cookie');
    throw new HttpError(401, 'invalid_refresh');
  }

  /** Ends the session on the server. Unknown tokens are ignored: logging out twice is not an error. */
  async function logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const { rows } = await pool.query<{ family_id: string }>('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [hashRefreshToken(rawToken)]);
    if (rows[0]) await revokeFamily(pool, rows[0].family_id);
  }

  /** Housekeeping, run by the worker: expired sessions and stale throttle rows. */
  async function pruneExpired(): Promise<{ tokens: number; failures: number }> {
    const tokens = await pool.query(`DELETE FROM refresh_tokens WHERE expires_at < clock_timestamp() - interval '7 days'`);
    const failures = await pool.query(`DELETE FROM login_failures WHERE updated_at < clock_timestamp() - interval '1 day'`);
    return { tokens: tokens.rowCount ?? 0, failures: failures.rowCount ?? 0 };
  }

  return { login, refresh, logout, reissueSession, pruneExpired };
}
