-- 0014_customer_accounts.sql : customers sign in on the website with an email and a password
--
-- An account is not the customers row itself: staff create customers at the counter without any account, and an
-- account is linked to a customers row only once its email is VERIFIED. Linking earlier would let anyone who knows a
-- customer's email read that customer's order history.
-- Nothing here is synced to staff devices.

CREATE TABLE customer_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES branches(id),
  email             text NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash     text NOT NULL,
  full_name         text NOT NULL CHECK (length(trim(full_name)) > 0),
  phone_e164        text CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  locale            text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  customer_id       uuid,                          -- set when the email is verified
  email_verified_at timestamptz,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at        timestamptz,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT customer_accounts_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT customer_accounts_customer_fk FOREIGN KEY (customer_id, branch_id) REFERENCES customers (id, branch_id),
  CONSTRAINT customer_accounts_verified_link CHECK (customer_id IS NULL OR email_verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX customer_accounts_email_uq ON customer_accounts (branch_id, email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX customer_accounts_customer_uq ON customer_accounts (customer_id) WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
CALL attach_sync_trigger('customer_accounts');
COMMENT ON TABLE customer_accounts IS 'Website sign-in for customers (email + password). Linked to a customers row only after the email is verified.';

-- Opaque session tokens in an httpOnly cookie; only their hash is stored.
CREATE TABLE customer_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX customer_sessions_token_uq ON customer_sessions (token_hash);
CREATE INDEX customer_sessions_account_idx ON customer_sessions (account_id);
CREATE INDEX customer_sessions_expiry_idx ON customer_sessions (expires_at);

-- One-time links sent by email: confirming the address, and choosing a new password.
CREATE TABLE customer_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX customer_tokens_hash_uq ON customer_tokens (token_hash);
CREATE INDEX customer_tokens_account_idx ON customer_tokens (account_id, purpose, created_at DESC);
