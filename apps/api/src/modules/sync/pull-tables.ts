import type { Permission } from '@mpe/shared';
import type { AuthContext } from '../auth/types';

/**
 * Which tables a device receives, who may read them, and how each is scoped.
 * Every source returns rows plus `sync_ts`: the timestamp the cursor orders by (normally updated_at).
 * Users, roles, branches and the bill of materials are not synced to devices yet.
 */
export interface PullSource { sql: string; params: unknown[] }
export interface PullTable {
  entity: string;
  /** The caller needs at least ONE of these permissions. */
  readAny: readonly Permission[];
  source(auth: AuthContext): PullSource;
}

const branchScoped = (table: string) => (auth: AuthContext): PullSource => ({
  sql: `SELECT t.*, t.updated_at AS sync_ts FROM ${table} t WHERE t.branch_id = $1`,
  params: [auth.branchId],
});

const orderChild = (table: string) => (auth: AuthContext): PullSource => branchScoped(table)(auth);

/** Dependency order: parents before children. */
export const PULL_TABLES: readonly PullTable[] = [
  { entity: 'customers', readAny: ['customers:read'], source: branchScoped('customers') },
  { entity: 'company_price_overrides', readAny: ['customers:read'], source: branchScoped('company_price_overrides') },
  { entity: 'products', readAny: ['products:read'], source: branchScoped('products') },
  { entity: 'inventory_items', readAny: ['inventory:read'], source: branchScoped('inventory_items') },
  { entity: 'product_materials', readAny: ['inventory:read'], source: branchScoped('product_materials') },
  { entity: 'notification_templates', readAny: ['notifications:templates:read'], source: branchScoped('notification_templates') },
  { entity: 'orders', readAny: ['orders:read'], source: branchScoped('orders') },
  { entity: 'order_items', readAny: ['orders:read'], source: orderChild('order_items') },
  { entity: 'barcodes', readAny: ['orders:read'], source: orderChild('barcodes') },
  { entity: 'order_status_history', readAny: ['orders:read'], source: orderChild('order_status_history') },
  { entity: 'stock_movements', readAny: ['inventory:read'], source: branchScoped('stock_movements') },
  { entity: 'transactions', readAny: ['transactions:read', 'transactions:collect'], source: orderChild('transactions') },
  { entity: 'notification_logs', readAny: ['notifications:logs:read'], source: branchScoped('notification_logs') },
];
