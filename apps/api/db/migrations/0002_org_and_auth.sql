-- 0002_org_and_auth.sql : Branches, Roles, Users

CREATE TABLE branches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  name_ar       text NOT NULL,
  name_en       text NOT NULL,
  country_code  char(2),
  timezone      text NOT NULL DEFAULT 'UTC',
  base_currency char(3) NOT NULL DEFAULT 'USD' CHECK (base_currency ~ '^[A-Z]{3}$'),
  phone_e164    text CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email         text,
  address       text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at    timestamptz,
  row_version   integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX branches_code_uq ON branches (lower(code)) WHERE deleted_at IS NULL;
CALL attach_sync_trigger('branches');
COMMENT ON TABLE branches IS 'Physical print-shop branches. One row today; every operational table carries branch_id for future expansion.';

-- Per-branch gap-free counters (order numbers). Not synced to clients.
CREATE TABLE branch_counters (
  branch_id  uuid NOT NULL REFERENCES branches(id),
  counter    text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (branch_id, counter)
);
COMMENT ON TABLE branch_counters IS 'Server-side sequences per branch (e.g. order numbers). Rolls back with the transaction, so numbers stay gap-free.';

CREATE FUNCTION next_branch_counter(p_branch uuid, p_name text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO branch_counters (branch_id, counter, next_value) VALUES (p_branch, p_name, 2)
  ON CONFLICT (branch_id, counter) DO UPDATE SET next_value = branch_counters.next_value + 1
  RETURNING next_value - 1;
$$;

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1
);
CALL attach_sync_trigger('roles');
COMMENT ON TABLE roles IS 'RBAC roles. The five system roles are seeded from packages/shared (single source of truth for permissions).';

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  role_id       uuid NOT NULL REFERENCES roles(id),
  full_name     text NOT NULL,
  email         text,
  phone_e164    text CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  password_hash text,                       -- NULL = account cannot sign in. NEVER sent to clients.
  locale        text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  is_active     boolean NOT NULL DEFAULT true,
  token_version integer NOT NULL DEFAULT 0, -- bump to revoke every issued token
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at    timestamptz,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT users_has_login_identifier CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_phone_uq ON users (phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX users_branch_role_idx ON users (branch_id, role_id) WHERE deleted_at IS NULL;
CREATE INDEX users_sync_idx ON users (branch_id, updated_at, id);
CALL attach_sync_trigger('users');
COMMENT ON TABLE users IS 'Staff accounts (Admin, Receptionist, Machine Operator, Warehouse Manager, Delivery). Customers are a separate table.';
