-- 0028_grant_credit_override.sql : the delegable-permissions allow-list must accept the new credit-limit override
-- before the owner can grant it to a staff member, matching TOGGLEABLE_PERMISSIONS in packages/shared.
ALTER TABLE users DROP CONSTRAINT users_granted_permissions_allowlist;
ALTER TABLE users ADD CONSTRAINT users_granted_permissions_allowlist CHECK (
  granted_permissions <@ ARRAY[
    'orders:cancel', 'orders:discount:override', 'transactions:refund', 'products:write', 'reports:read',
    'inventory:manage', 'notifications:templates:write', 'orders:items:override', 'orders:credit:override'
  ]::text[]
);
