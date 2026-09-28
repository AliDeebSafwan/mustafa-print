import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { effectivePermissions, hasPermission, roleDefinition, type Permission } from '@mpe/shared';
import { HttpError } from '../../http-error';
import { verifyAccessToken } from './tokens';
import type { AuthConfig } from './types';

/**
 * Verifies the bearer token, then re-reads the user: a deactivated account or a bumped token_version is locked out
 * immediately instead of when the 15-minute token expires (important for a lost tablet). Permissions are computed
 * fresh here too (role + any grants), so a permission the owner just changed takes effect on the very next request,
 * not on the next login.
 */
export function authenticate(deps: { pool: Pool; cfg: Pick<AuthConfig, 'accessSecret'> }): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new HttpError(401, 'unauthorized', 'Missing bearer token');

    const claims = await verifyAccessToken(deps.cfg, token).catch(() => { throw new HttpError(401, 'invalid_token', 'Invalid or expired token'); });

    const { rows } = await deps.pool.query<{ branch_id: string; full_name: string; locale: 'ar' | 'en'; is_active: boolean; token_version: number; role_key: string; granted_permissions: string[] }>(
      `SELECT u.branch_id, u.full_name, u.locale, u.is_active, u.token_version, u.granted_permissions, r.key AS role_key
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL`, [claims.userId]);
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== claims.tokenVersion) throw new HttpError(401, 'invalid_token', 'Session is no longer valid');

    const baseRole = roleDefinition(user.role_key);
    if (!baseRole) throw new HttpError(403, 'forbidden', 'Unknown role');
    const role = { ...baseRole, permissions: effectivePermissions(baseRole, user.granted_permissions) };
    req.auth = { userId: claims.userId, branchId: user.branch_id, fullName: user.full_name, locale: user.locale, role };
    next();
  };
}

export const requirePermission = (permission: Permission): RequestHandler => (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, 'unauthorized');
  if (!hasPermission(req.auth.role.permissions, permission)) throw new HttpError(403, 'forbidden', `Missing permission ${permission}`);
  next();
};

/** Cookie-authenticated endpoints must come from one of our own origins (defence in depth on top of SameSite=Strict). */
export const requireAllowedOrigin = (allowed: readonly string[]): RequestHandler => (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && !allowed.includes(origin)) throw new HttpError(403, 'origin_not_allowed');
  next();
};
