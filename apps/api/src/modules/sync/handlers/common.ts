import { hasPermission, type Permission } from '@mpe/shared';
import { MutationConflict, MutationRejected, type HandlerContext } from './types';

export type DbRow = Record<string, unknown>;

export function requirePermission(ctx: HandlerContext, permission: Permission): void {
  if (!hasPermission(ctx.auth.role.permissions, permission)) throw new MutationRejected('forbidden', `missing permission ${permission}`);
}

export interface OrderRow extends DbRow {
  id: string;
  customer_id: string;
  status: string;
  currency: string;
}

/** Locks the order row so two devices changing it at once are applied one after the other. */
export async function lockOrder(ctx: HandlerContext, orderId: string): Promise<OrderRow> {
  const { rows } = await ctx.client.query<OrderRow>(
    'SELECT * FROM orders WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [orderId, ctx.auth.branchId]);
  const order = rows[0];
  if (!order) throw new MutationRejected('order_not_found');
  return order;
}

/** A row id reused for a different branch must never be silently treated as "already applied". */
export async function assertIdIsOurs(ctx: HandlerContext, table: 'customers' | 'stock_movements' | 'transactions', id: string): Promise<void> {
  const { rowCount } = await ctx.client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND branch_id = $2`, [id, ctx.auth.branchId]);
  if (!rowCount) throw new MutationRejected('id_in_use');
}

const isNullish = (v: unknown): v is null | undefined => v === null || v === undefined;

/** Compares a value as stored (pg types) with the value a device remembers (JSON types). */
/**
 * JSON with object keys in a fixed order. PostgreSQL stores jsonb with its own key order, so comparing the printed
 * form directly would report a conflict for two values that are in fact identical.
 */
function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.stringify(walk(value));
}

export function sameValue(current: unknown, remembered: unknown): boolean {
  if (isNullish(current) || isNullish(remembered)) return isNullish(current) && isNullish(remembered);
  if (current instanceof Date) return current.getTime() === new Date(String(remembered)).getTime();
  // jsonb columns come back as objects; compare their content, regardless of how the keys happen to be ordered.
  if (typeof current === 'object' || typeof remembered === 'object') return canonical(current) === canonical(remembered);
  return String(current) === String(remembered);
}

const COLUMN = /^[a-z][a-z0-9_]*$/;

/**
 * Field-level optimistic concurrency. The device sends what it changed (`changes`) and what those fields looked like
 * when the user started editing (`base`). Fields nobody else touched are applied, so two people editing DIFFERENT
 * fields of one row both win; if someone changed the SAME field meanwhile the mutation becomes a conflict.
 */
export async function applyPatch(ctx: HandlerContext, opts: {
  table: 'customers' | 'orders' | 'products' | 'inventory_items' | 'product_materials' | 'company_price_overrides';
  id: string;
  changes: DbRow;
  base: DbRow;
  /** Runs on the freshly locked row (business rules such as "closed orders are read-only"). */
  guard?: (current: DbRow) => void;
  /** Extra static assignments, e.g. 'consent_recorded_at = clock_timestamp()'. Never user input. */
  extraAssignments?: string[];
}): Promise<DbRow> {
  const { rows } = await ctx.client.query<DbRow>(
    `SELECT * FROM ${opts.table} WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE`, [opts.id, ctx.auth.branchId]);
  const current = rows[0];
  if (!current) throw new MutationRejected('not_found');
  opts.guard?.(current);

  const fields = Object.keys(opts.changes);
  const withoutBase = fields.filter((f) => !(f in opts.base));
  if (withoutBase.length) throw new MutationRejected('missing_base', `send the original value for: ${withoutBase.join(', ')}`);
  const clashing = fields.filter((f) => !sameValue(current[f], opts.base[f]));
  if (clashing.length) throw new MutationConflict(`changed on the server meanwhile: ${clashing.join(', ')}`, current, opts.table);

  const assignments = fields.map((field, i) => {
    if (!COLUMN.test(field)) throw new MutationRejected('invalid_field', field);
    // Arrays and objects are jsonb columns (price tiers, product options); everything else goes as-is.
    const value = opts.changes[field];
    return `${field} = $${i + 3}${value !== null && typeof value === 'object' ? '::jsonb' : ''}`;
  });
  const updated = await ctx.client.query<DbRow>(
    `UPDATE ${opts.table} SET ${[...assignments, ...(opts.extraAssignments ?? [])].join(', ')} WHERE id = $1 AND branch_id = $2 RETURNING *`,
    [opts.id, ctx.auth.branchId, ...fields.map((f) => { const v = opts.changes[f]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; })]);
  return updated.rows[0]!;
}
