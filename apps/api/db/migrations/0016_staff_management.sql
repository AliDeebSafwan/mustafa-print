-- 0016_staff_management.sql : the owner manages staff and delegated permissions from the app, not the database
--
-- Design: the "staff" role (seeded from packages/shared, like every other system role) carries a deliberately small
-- default permission set. `granted_permissions` lets the owner hand a specific staff member a few extra permissions
-- from a fixed, small allow-list (never a role's own base set, never anything on the never-delegable list such as
-- content:manage or users:manage) without inventing a new role per employee.

ALTER TABLE users ADD COLUMN granted_permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD CONSTRAINT users_granted_permissions_allowlist CHECK (
  granted_permissions <@ ARRAY[
    'orders:cancel', 'orders:discount:override', 'transactions:refund', 'products:write', 'reports:read',
    'inventory:manage', 'notifications:templates:write'
  ]::text[]
);
COMMENT ON COLUMN users.granted_permissions IS
  'Extra permissions the owner delegated to this user, on top of their role''s base set. Kept in sync with TOGGLEABLE_PERMISSIONS in packages/shared/src/permissions.ts — a schema test checks the two never drift apart.';

-- What the owner did to the team and the shop's settings. Append-only: even the owner cannot edit or delete an
-- entry, or the log stops being evidence of anything.
CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  actor_user_id  uuid REFERENCES users(id),
  action         text NOT NULL,
  target_type    text,
  target_id      uuid,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,     -- a short, human-readable summary; never a password or a token
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_log_branch_idx ON audit_log (branch_id, created_at DESC);
CALL attach_append_only('audit_log');
COMMENT ON TABLE audit_log IS 'Sensitive actions on the team and the shop''s settings, for the owner to review. Append-only.';

COMMENT ON TABLE roles IS 'RBAC roles. The system roles are seeded from packages/shared (single source of truth for permissions); "staff" is the shop''s default non-admin role.';
