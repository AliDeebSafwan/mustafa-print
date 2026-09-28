-- 0007_notifications.sql : templates + delivery log (doubles as the outbound queue)

CREATE TABLE notification_templates (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id                  uuid NOT NULL REFERENCES branches(id),
  template_key               text NOT NULL,         -- order.received, order.printing, order.ready, ...
  channel                    text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  locale                     text NOT NULL CHECK (locale IN ('ar','en')),
  subject                    text,                  -- email only
  body                       text NOT NULL,         -- contains {{variable}} placeholders
  variables                  text[] NOT NULL DEFAULT '{}',   -- ordered list; also the WhatsApp {{1}},{{2}} mapping
  provider_template_name     text,                  -- WhatsApp approved template (needed outside the 24h window)
  provider_template_language text,
  is_active                  boolean NOT NULL DEFAULT true,
  is_system                  boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at                 timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at                 timestamptz,
  row_version                integer NOT NULL DEFAULT 1,
  CONSTRAINT notification_templates_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT notification_templates_email_subject CHECK (channel <> 'email' OR subject IS NOT NULL)
);
CREATE UNIQUE INDEX notification_templates_uq ON notification_templates (branch_id, template_key, channel, locale) WHERE deleted_at IS NULL;
CREATE INDEX notification_templates_sync_idx  ON notification_templates (branch_id, updated_at, id);
CALL attach_sync_trigger('notification_templates');
COMMENT ON TABLE notification_templates IS 'Editable message templates per channel and language. Allowed variables are whitelisted in packages/shared.';

CREATE TABLE notification_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- device-generated for manual sends made offline
  branch_id           uuid NOT NULL REFERENCES branches(id),
  order_id            uuid,
  customer_id         uuid,
  template_id         uuid,
  template_key        text,
  channel             text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  locale              text NOT NULL CHECK (locale IN ('ar','en')),
  trigger             text NOT NULL DEFAULT 'status_change' CHECK (trigger IN ('status_change','manual','invoice','system')),
  recipient           text NOT NULL,
  subject             text,
  body                text NOT NULL,                       -- final rendered text (what the customer received)
  variables           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','read','failed','skipped')),
  provider            text,
  provider_message_id text,
  error_code          text,
  error_message       text,
  attempts            integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 5,
  next_attempt_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at           timestamptz,                          -- worker lease
  queued_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  dedupe_key          text,                                 -- e.g. order:<id>:printing:whatsapp
  created_by          uuid REFERENCES users(id),            -- NULL = automatic trigger
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at          timestamptz,
  row_version         integer NOT NULL DEFAULT 1,
  CONSTRAINT notification_logs_order_fk    FOREIGN KEY (order_id, branch_id)    REFERENCES orders (id, branch_id),
  CONSTRAINT notification_logs_customer_fk FOREIGN KEY (customer_id, branch_id) REFERENCES customers (id, branch_id),
  CONSTRAINT notification_logs_template_fk FOREIGN KEY (template_id, branch_id) REFERENCES notification_templates (id, branch_id)
);
CREATE UNIQUE INDEX notification_logs_dedupe_uq   ON notification_logs (branch_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX notification_logs_provider_uq ON notification_logs (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX notification_logs_queue_idx ON notification_logs (status, next_attempt_at) WHERE status IN ('queued','sending');
CREATE INDEX notification_logs_order_idx ON notification_logs (order_id, queued_at DESC);
CREATE INDEX notification_logs_sync_idx  ON notification_logs (branch_id, updated_at, id);
CALL attach_sync_trigger('notification_logs');
COMMENT ON TABLE notification_logs IS 'Every message ever queued. The worker claims rows with FOR UPDATE SKIP LOCKED, so no Redis is needed on the small VPS.';
