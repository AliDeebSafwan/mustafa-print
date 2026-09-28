-- 0024_proofs.sql : the customer approves a proof, or asks for changes, from a link
--
-- Every proof upload is a new numbered version with its file's SHA-256, and every customer answer is written to an
-- append-only table that records WHICH version (and exact file) was answered, and when. Nobody, the owner included,
-- can edit or delete an answer afterwards: that record is the shop's evidence if a job is ever disputed.

CREATE TABLE proofs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  order_id       uuid NOT NULL,
  version        integer NOT NULL CHECK (version > 0),
  public_code    text NOT NULL CHECK (public_code ~ '^[0-9A-HJKMNP-TV-Z]{10,16}$'),
  storage_key    text NOT NULL,
  original_name  text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('pdf', 'jpg', 'png')),
  bytes          bigint NOT NULL CHECK (bytes > 0),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested', 'superseded')),
  uploaded_by    uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT proofs_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT proofs_order_fk FOREIGN KEY (order_id, branch_id) REFERENCES orders (id, branch_id),
  CONSTRAINT proofs_order_version_uq UNIQUE (order_id, version)
);
CREATE UNIQUE INDEX proofs_public_code_uq ON proofs (public_code);
CALL attach_sync_trigger('proofs');
COMMENT ON TABLE proofs IS 'Numbered proof versions for an order, each with its file hash; the customer answers one by link.';

CREATE TABLE proof_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  proof_id       uuid NOT NULL,
  order_id       uuid NOT NULL,
  proof_version  integer NOT NULL,
  file_sha256    text NOT NULL,
  decision       text NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  comment        text,
  responded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  user_agent     text,
  CONSTRAINT proof_responses_proof_fk FOREIGN KEY (proof_id, branch_id) REFERENCES proofs (id, branch_id),
  CONSTRAINT proof_responses_comment_needed CHECK (decision = 'approved' OR length(trim(coalesce(comment, ''))) > 0)
);
CREATE INDEX proof_responses_order_idx ON proof_responses (order_id, responded_at);
CALL attach_append_only('proof_responses');
COMMENT ON TABLE proof_responses IS 'What the customer answered, for which proof version and file hash, and when. Append-only: evidence in a dispute.';

-- Synced to staff devices with the order, so the counter sees "customer approved" without a connection.
ALTER TABLE orders ADD COLUMN proof_status text CHECK (proof_status IN ('pending', 'approved', 'changes_requested'));
