import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES, ORDER_STATUS_TRANSITIONS, canTransition, generatePublicCode, PUBLIC_CODE_RE, uuidv7,
  hasPermission, ROLE_DEFINITIONS, canMoveToStatus, roleDefinition, TERMINAL_STATUSES,
  effectivePermissions, TOGGLEABLE_PERMISSIONS,
} from './index';

describe('order status machine', () => {
  it('has a transition entry for every status and only known targets', () => {
    for (const s of ORDER_STATUSES) {
      expect(ORDER_STATUS_TRANSITIONS[s]).toBeDefined();
      for (const t of ORDER_STATUS_TRANSITIONS[s]) expect(ORDER_STATUSES).toContain(t);
    }
  });
  it('terminal statuses have no exits', () => {
    for (const s of TERMINAL_STATUSES) expect(ORDER_STATUS_TRANSITIONS[s]).toHaveLength(0);
  });
  it('allows the happy path and blocks shortcuts', () => {
    expect(canTransition('received', 'printing')).toBe(true);
    expect(canTransition('printing', 'ready')).toBe(true);
    expect(canTransition('ready', 'delivered')).toBe(true);
    expect(canTransition('received', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'printing')).toBe(false);
  });
});

describe('ids', () => {
  it('public codes match the DB constraint and are unique enough', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generatePublicCode();
      expect(c).toMatch(PUBLIC_CODE_RE);
      seen.add(c);
    }
    expect(seen.size).toBe(2000);
  });
  it('uuidv7 is a valid v7 uuid and sorts by time', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_001_000);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe('rbac', () => {
  it('wildcards', () => {
    expect(hasPermission(['*'], 'orders:cancel')).toBe(true);
    expect(hasPermission(['orders:*'], 'orders:read')).toBe(true);
    expect(hasPermission(['orders:read'], 'orders:create')).toBe(false);
  });
  it('defines the five required roles, with "staff" as the shop\'s simple default', () => {
    expect(ROLE_DEFINITIONS.map((r) => r.key).sort()).toEqual(['admin', 'machine_operator', 'receptionist', 'staff', 'warehouse_manager']);
  });

  describe('effectivePermissions (role + owner-delegated extras)', () => {
    const staff = roleDefinition('staff')!;
    const admin = roleDefinition('admin')!;

    it('adds a delegated extra on top of the role\'s own base set', () => {
      const result = effectivePermissions(staff, ['orders:cancel']);
      expect(result).toEqual(expect.arrayContaining([...staff.permissions, 'orders:cancel']));
      expect(result).not.toContain('products:write');   // never granted here
    });

    it('never lets a grant smuggle in something off the allow-list, even if it somehow got stored', () => {
      const result = effectivePermissions(staff, ['users:manage', 'branches:manage', 'orders:cancel']);
      expect(result).not.toContain('users:manage');
      expect(result).not.toContain('branches:manage');
      expect(result).toContain('orders:cancel');
    });

    it('a role that already has a permission is not doubled by also granting it', () => {
      expect(effectivePermissions(staff, ['orders:create' as never])).toEqual([...new Set(staff.permissions)]);
    });

    it('an admin\'s "*" is never narrowed or widened by grants', () => {
      expect(effectivePermissions(admin, ['orders:cancel'])).toEqual(['*']);
      expect(effectivePermissions(admin, [])).toEqual(['*']);
    });

    it('no grants at all is just the role\'s own set', () => {
      expect(effectivePermissions(staff)).toEqual([...staff.permissions]);
    });

    it('the delegable list never includes anything the shop keeps for the owner alone', () => {
      for (const owner_only of ['content:manage', 'users:manage', 'branches:manage', 'settings:manage', 'orders:delivery_fee:set']) {
        expect(TOGGLEABLE_PERMISSIONS).not.toContain(owner_only);
      }
    });
  });
  it('role status scopes', () => {
    const op = roleDefinition('machine_operator')!;
    expect(canMoveToStatus(op, 'printing')).toBe(true);
    expect(canMoveToStatus(op, 'delivered')).toBe(false);
    expect(canMoveToStatus(roleDefinition('admin')!, 'cancelled')).toBe(true);
  });
});
