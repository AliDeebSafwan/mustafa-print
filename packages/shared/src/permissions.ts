import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from './order-status';

export const PERMISSIONS = [
  'orders:read', 'orders:create', 'orders:update', 'orders:cancel', 'orders:discount:override', 'orders:delivery_fee:set', 'orders:deposit:override', 'orders:items:override', 'orders:credit:override', 'orders:status:update',
  'customers:read', 'customers:write', 'customers:credit:manage', 'customer_accounts:manage',
  'products:read', 'products:write',
  'content:manage',
  'inventory:read', 'inventory:receive', 'inventory:consume', 'inventory:adjust', 'inventory:manage',
  'transactions:read', 'transactions:collect', 'transactions:refund', 'transactions:settle',
  'notifications:send', 'notifications:logs:read', 'notifications:templates:read', 'notifications:templates:write',
  'reports:read', 'users:manage', 'branches:manage', 'settings:manage',
  'sync:use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = ['admin', 'staff', 'receptionist', 'machine_operator', 'warehouse_manager'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  name_ar: string;
  name_en: string;
  permissions: readonly (Permission | '*')[];
  /** Statuses this role may move an order INTO. 'all' = no extra restriction. */
  statusScope: readonly OrderStatus[] | 'all';
}

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: 'admin', name_ar: 'مدير النظام', name_en: 'Admin',
    permissions: ['*'], statusScope: 'all',
  },
  {
    // The default role for a shop with an owner and one or two staff: everything needed to run the counter and the
    // floor, none of what the owner keeps for themself (refunds, cancellations, prices, financial reports, the
    // website). The owner can hand any of those over per person via granted_permissions.
    key: 'staff', name_ar: 'موظف', name_en: 'Staff',
    permissions: [
      'customers:read', 'customers:write',
      'orders:read', 'orders:create', 'orders:update', 'orders:status:update',
      'products:read', 'inventory:read', 'inventory:receive', 'inventory:consume', 'inventory:adjust',
      'transactions:read', 'transactions:collect', 'transactions:settle',
      'notifications:send', 'notifications:logs:read', 'notifications:templates:read',
      'sync:use',
    ],
    statusScope: 'all',
  },
  {
    key: 'receptionist', name_ar: 'موظف الاستقبال', name_en: 'Receptionist',
    permissions: [
      'customers:read', 'customers:write',
      'orders:read', 'orders:create', 'orders:update', 'orders:status:update',
      'products:read', 'inventory:read',
      'transactions:read', 'transactions:collect', 'transactions:settle',   // settling cash collected away from the counter, not yet banked
      'notifications:send', 'notifications:logs:read', 'notifications:templates:read',
      'sync:use',
    ],
    statusScope: ['received', 'in_design', 'awaiting_approval', 'ready', 'delivered', 'cancelled'],
  },
  {
    key: 'machine_operator', name_ar: 'مشغّل الآلة', name_en: 'Machine Operator',
    permissions: ['orders:read', 'orders:status:update', 'products:read', 'inventory:read', 'inventory:consume', 'sync:use'],
    statusScope: ['printing', 'finishing', 'ready'],
  },
  {
    key: 'warehouse_manager', name_ar: 'مدير المستودع', name_en: 'Warehouse Manager',
    permissions: ['inventory:read', 'inventory:receive', 'inventory:consume', 'inventory:adjust', 'inventory:manage', 'products:read', 'orders:read', 'sync:use'],
    statusScope: [],
  },
];

export const roleDefinition = (key: string): RoleDefinition | undefined => ROLE_DEFINITIONS.find((r) => r.key === key);

/**
 * Extra permissions the owner may delegate to a non-admin user, on top of their role's base set. Deliberately a
 * small, fixed allow-list — never a whole role, and never anything that changes who the owner is (content:manage,
 * users:manage, branches:manage, settings:manage, orders:delivery_fee:set stay owner-only forever). The database has
 * the same list as a CHECK constraint (migration 0016); a schema test keeps the two from drifting apart.
 */
export const TOGGLEABLE_PERMISSIONS = [
  'orders:cancel', 'orders:discount:override', 'transactions:refund', 'products:write', 'reports:read',
  'inventory:manage', 'notifications:templates:write', 'orders:items:override', 'orders:credit:override',
] as const satisfies readonly Permission[];
export type ToggleablePermission = (typeof TOGGLEABLE_PERMISSIONS)[number];

/**
 * A user's real permission set: their role's base set, plus whichever of their granted extras are actually on the
 * allow-list (defence in depth — a stale or tampered grant can never smuggle in something not on the list). A role
 * with '*' (admin) is never narrowed or widened by grants: owning everything is not something to opt in or out of.
 */
export function effectivePermissions(role: RoleDefinition, granted: readonly string[] = []): readonly (Permission | '*')[] {
  if (role.permissions.includes('*')) return role.permissions;
  const extra = granted.filter((p): p is ToggleablePermission => (TOGGLEABLE_PERMISSIONS as readonly string[]).includes(p));
  return [...new Set([...role.permissions, ...extra])];
}

/** '*' grants everything; 'orders:*' grants every orders:... permission. */
export function hasPermission(granted: readonly string[], needed: Permission): boolean {
  if (granted.includes('*') || granted.includes(needed)) return true;
  const ns = needed.split(':')[0];
  return granted.includes(`${ns}:*`);
}

export function canMoveToStatus(role: RoleDefinition, to: OrderStatus): boolean {
  return role.statusScope === 'all' || role.statusScope.includes(to);
}

/**
 * Why `role` may not move an order to `to`, or null when it may. One rule for the UI (hide the button) and the server
 * (reject the mutation), so they cannot disagree.
 */
export function whyCannotSetStatus(role: RoleDefinition, to: OrderStatus): string | null {
  if (!hasPermission(role.permissions, 'orders:status:update')) return 'missing permission orders:status:update';
  if (!canMoveToStatus(role, to)) return `role ${role.key} may not set status ${to}`;
  if (to === 'cancelled' && !hasPermission(role.permissions, 'orders:cancel')) return 'missing permission orders:cancel';
  return null;
}

/** The buttons a user should see for an order in status `from`: legal transitions this role is allowed to make. */
export const allowedNextStatuses = (role: RoleDefinition, from: OrderStatus): OrderStatus[] =>
  ORDER_STATUS_TRANSITIONS[from].filter((to) => whyCannotSetStatus(role, to) === null);
