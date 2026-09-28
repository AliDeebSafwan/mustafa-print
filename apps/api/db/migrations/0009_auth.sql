-- 0009_auth.sql : refresh-token sessions and login throttling (server-only: never synced to devices)

CREATE TABLE refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL,                      -- one login = one family; reuse of a rotated token revokes the family
  user_id       uuid NOT NULL REFERENCES users(id),
  token_hash    text NOT NULL,                      -- sha256(hex) of the opaque token; the token itself is never stored
  token_version integer NOT NULL,                   -- users.token_version when issued; a bump revokes every session
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  replaced_by   uuid REFERENCES refresh_tokens(id)  -- set when the token was rotated
);
CREATE UNIQUE INDEX refresh_tokens_hash_uq ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_family_idx     ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx       ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX refresh_tokens_expiry_idx     ON refresh_tokens (expires_at);
COMMENT ON TABLE refresh_tokens IS 'Rotating refresh tokens. Presenting an already-rotated token (outside a short grace window) revokes the whole family.';

-- Keyed by the login identifier, NOT the user id: unknown accounts throttle exactly like real ones,
-- so response behaviour never reveals whether an account exists.
CREATE TABLE login_failures (
  identifier   text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE login_failures IS 'Consecutive failed logins per identifier; locks the identifier for a while after too many.';
