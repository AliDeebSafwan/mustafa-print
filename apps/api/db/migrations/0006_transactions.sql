-- 0006_transactions.sql : payments, refunds, COD collection

CREATE TABLE transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),    -- device-generated => idempotent
  branch_id        uuid NOT NULL REFERENCES branches(id),
  order_id         uuid,
  customer_id      uuid,
  txn_type         text NOT NULL CHECK (txn_type IN ('payment','refund','adjustment')),
  method           text NOT NULL CHECK (method IN ('cash','cod','whish_money')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  provider         text,                 -- 'whish_money' for online payments
  provider_txn_id  text,                 -- provider reference (webhook idempotency key)
  provider_payload jsonb,                -- last raw webhook / API response, for support
  collected_by     uuid REFERENCES users(id),   -- courier / receptionist who took the cash
  collected_at     timestamptz,
  settled_at       timestamptz,          -- cash handed over to the shop (COD reconciliation)
  settled_by       uuid REFERENCES users(id),
  note             text,
  created_by       uuid REFERENCES users(id),
  device_id        text,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at       timestamptz,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT transactions_order_fk    FOREIGN KEY (order_id, branch_id)    REFERENCES orders (id, branch_id),
  CONSTRAINT transactions_customer_fk FOREIGN KEY (customer_id, branch_id) REFERENCES customers (id, branch_id)
);
CREATE UNIQUE INDEX transactions_provider_uq ON transactions (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX transactions_order_idx   ON transactions (order_id);
CREATE INDEX transactions_cod_open_idx ON transactions (branch_id, collected_by) WHERE method = 'cod' AND status = 'completed' AND settled_at IS NULL;
CREATE INDEX transactions_sync_idx    ON transactions (branch_id, updated_at, id);
CALL attach_sync_trigger('transactions');
COMMENT ON TABLE transactions IS 'Money movements per order (payment / refund). COD stays unsettled until the courier hands the cash to the shop.';

-- Derive orders.paid_total / payment_status from completed transactions.
CREATE FUNCTION refresh_order_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid := coalesce(NEW.order_id, OLD.order_id);
  v_paid  numeric(14,2);
  v_refund numeric(14,2);
BEGIN
  IF v_order IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum(amount) FILTER (WHERE txn_type = 'payment'), 0),
         coalesce(sum(amount) FILTER (WHERE txn_type = 'refund'),  0)
    INTO v_paid, v_refund
    FROM transactions
   WHERE order_id = v_order AND status = 'completed' AND deleted_at IS NULL;

  UPDATE orders o
     SET paid_total = v_paid - v_refund,
         payment_status = CASE
           WHEN v_paid > 0 AND v_paid - v_refund <= 0          THEN 'refunded'
           WHEN o.total > 0 AND v_paid - v_refund >= o.total    THEN 'paid'
           WHEN v_paid - v_refund > 0                           THEN 'partial'
           ELSE 'unpaid' END
   WHERE o.id = v_order;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_refresh_order_payment AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION refresh_order_payment();
