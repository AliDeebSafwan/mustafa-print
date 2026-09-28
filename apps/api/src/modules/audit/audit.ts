import type { AuditAction } from '@mpe/shared';
import type { Queryable } from '../../db/pool';
import type { AuthContext } from '../auth/types';

/**
 * One entry the owner will read later, on the team screen's audit log. Always call this inside the same
 * transaction as the change it records, so an entry can never exist for a change that was rolled back, or be
 * missing for one that committed.
 */
export async function logAudit(
  q: Queryable, auth: AuthContext, action: AuditAction, target: { type: string; id?: string | null }, details: Record<string, unknown> = {},
): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (branch_id, actor_user_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [auth.branchId, auth.userId, action, target.type, target.id ?? null, JSON.stringify(details)]);
}
