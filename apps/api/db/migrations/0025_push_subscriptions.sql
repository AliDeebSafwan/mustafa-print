-- 0025_push_subscriptions.sql : Web Push, the no-Meta-approval alternative to a WhatsApp alert for new web orders
--
-- One row per browser that opted in (a person can have several: phone and desktop). Never synced to the offline
-- store — a push subscription belongs to one browser's install of the app, not to the shop's data.

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES branches(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_sent_at timestamptz,
  last_error   text                -- set when the push service reports the subscription is gone (410/404)
);
CREATE UNIQUE INDEX push_subscriptions_endpoint_uq ON push_subscriptions (endpoint);
CREATE INDEX push_subscriptions_branch_idx ON push_subscriptions (branch_id) WHERE last_error IS NULL;
COMMENT ON TABLE push_subscriptions IS 'Web Push endpoints for staff browsers, used to alert whoever is subscribed when a new web order arrives.';
