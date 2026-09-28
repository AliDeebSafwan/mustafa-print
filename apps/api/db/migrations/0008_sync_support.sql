-- 0008_sync_support.sql : idempotency + conflict bookkeeping for offline clients

CREATE TABLE client_mutations (
  id                uuid PRIMARY KEY,                  -- generated on the device; replaying the same id is a no-op
  branch_id         uuid NOT NULL REFERENCES branches(id),
  user_id           uuid REFERENCES users(id),
  device_id         text NOT NULL,
  entity            text NOT NULL,
  entity_id         uuid NOT NULL,
  op                text NOT NULL CHECK (op IN ('insert','update','delete','status_change','stock_movement')),
  base_version      integer,                           -- row_version the client edited from (conflict detection)
  payload           jsonb NOT NULL,
  result            text NOT NULL CHECK (result IN ('applied','duplicate','conflict','rejected')),
  error             text,
  client_created_at timestamptz,
  received_at       timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX client_mutations_entity_idx ON client_mutations (entity, entity_id);
CREATE INDEX client_mutations_review_idx ON client_mutations (branch_id, received_at DESC) WHERE result IN ('conflict','rejected');
COMMENT ON TABLE client_mutations IS 'Every mutation pushed by an offline device, with the outcome. Makes push idempotent and gives admins a conflict review queue.';
