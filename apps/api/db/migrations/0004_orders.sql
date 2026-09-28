-- 0004_orders.sql : Orders, OrderItems, Order status history, Barcodes
--
-- Offline creation: the device generates `id` (uuid) and `public_code` (random, unguessable).
-- The human-friendly `order_number` is assigned by the server on first insert (gap-free per branch).

CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES branches(id),
  order_number      bigint,
  public_code       text NOT NULL CHECK (public_code ~ '^[0-9A-HJKMNP-TV-Z]{10,16}$'),  -- Crockford base32; used in barcode + tracking URL
  customer_id       uuid NOT NULL,
  source            text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','web','import')),
  status            text NOT NULL DEFAULT 'received' CHECK (status IN
                      ('pending','received','in_design','awaiting_approval','printing','finishing','ready','out_for_delivery','delivered','cancelled')),
  status_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  fulfillment_type  text NOT NULL DEFAULT 'pickup' CHECK (fulfillment_type IN ('pickup','delivery')),
  delivery_address  text,
  delivery_city     text,
  delivery_notes    text,
  delivery_user_id  uuid REFERENCES users(id),
  payment_status    text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  payment_method    text NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cash','cod','whish_money')),
  currency          char(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal          numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total    numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  delivery_fee      numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  tax_total         numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total             numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid_total        numeric(14,2) NOT NULL DEFAULT 0,          -- derived from transactions (trigger)
  customer_notes    text,
  internal_notes    text,
  due_at            timestamptz,
  placed_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_by        uuid REFERENCES users(id),                 -- NULL for website orders
  origin_device_id  text,
  legacy_id         text,
  legacy_source     text,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at        timestamptz,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT orders_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id, branch_id) REFERENCES customers (id, branch_id),
  CONSTRAINT orders_total_consistent CHECK (total = subtotal - discount_total + delivery_fee + tax_total),
  CONSTRAINT orders_delivery_address CHECK (fulfillment_type = 'pickup' OR delivery_address IS NOT NULL)
);
CREATE UNIQUE INDEX orders_public_code_uq ON orders (public_code);
CREATE UNIQUE INDEX orders_number_uq      ON orders (branch_id, order_number) WHERE order_number IS NOT NULL;
CREATE UNIQUE INDEX orders_legacy_uq      ON orders (branch_id, legacy_source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX orders_board_idx    ON orders (branch_id, status, placed_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX orders_customer_idx ON orders (customer_id, placed_at DESC);
CREATE INDEX orders_courier_idx  ON orders (delivery_user_id, status) WHERE delivery_user_id IS NOT NULL;
CREATE INDEX orders_sync_idx     ON orders (branch_id, updated_at, id);
COMMENT ON TABLE orders IS 'Customer orders. total = subtotal - discount_total + delivery_fee + tax_total (enforced). paid_total/payment_status are derived from transactions.';

-- Assign the human order number on insert (server-side, gap-free per branch).
CREATE FUNCTION orders_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_number IS NULL THEN
    NEW.order_number := next_branch_counter(NEW.branch_id, 'order');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_orders_number BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION orders_before_insert();

-- Keep status timestamps coherent.
CREATE FUNCTION orders_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := clock_timestamp();
    IF NEW.status = 'delivered' THEN NEW.completed_at := coalesce(NEW.completed_at, clock_timestamp()); END IF;
    IF NEW.status = 'cancelled' THEN NEW.cancelled_at := coalesce(NEW.cancelled_at, clock_timestamp()); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_orders_status BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_before_update();
CALL attach_sync_trigger('orders');

CREATE TABLE order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  order_id       uuid NOT NULL,
  product_id     uuid,                                  -- NULL = custom / one-off item
  sort_order     integer NOT NULL DEFAULT 0,
  name_snapshot  text NOT NULL,                         -- product name at order time
  unit           text NOT NULL DEFAULT 'piece',
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price     numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  discount       numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total     numeric(14,2) NOT NULL CHECK (line_total >= 0),
  options        jsonb NOT NULL DEFAULT '{}'::jsonb,    -- chosen size / paper / finishing ...
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at     timestamptz,
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT order_items_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT order_items_order_fk   FOREIGN KEY (order_id, branch_id)   REFERENCES orders (id, branch_id),
  CONSTRAINT order_items_product_fk FOREIGN KEY (product_id, branch_id) REFERENCES products (id, branch_id)
);
CREATE INDEX order_items_order_idx ON order_items (order_id) WHERE deleted_at IS NULL;
CREATE INDEX order_items_sync_idx  ON order_items (branch_id, updated_at, id);
CALL attach_sync_trigger('order_items');
COMMENT ON TABLE order_items IS 'Line items. Totals are recomputed server-side on sync; the client value is never trusted.';

CREATE TABLE barcodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  order_id        uuid NOT NULL,
  order_item_id   uuid,
  label_type      text NOT NULL DEFAULT 'order' CHECK (label_type IN ('order','item','package')),
  code            text NOT NULL,                        -- exact string encoded in the QR / Code128
  symbology       text NOT NULL DEFAULT 'qr' CHECK (symbology IN ('qr','code128')),
  is_active       boolean NOT NULL DEFAULT true,
  print_count     integer NOT NULL DEFAULT 0 CHECK (print_count >= 0),
  last_printed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at      timestamptz,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT barcodes_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT barcodes_order_fk FOREIGN KEY (order_id, branch_id)      REFERENCES orders (id, branch_id),
  CONSTRAINT barcodes_item_fk  FOREIGN KEY (order_item_id, branch_id) REFERENCES order_items (id, branch_id)
);
CREATE UNIQUE INDEX barcodes_code_uq  ON barcodes (branch_id, code) WHERE deleted_at IS NULL;
CREATE INDEX barcodes_order_idx       ON barcodes (order_id);
CREATE INDEX barcodes_sync_idx        ON barcodes (branch_id, updated_at, id);
CALL attach_sync_trigger('barcodes');
COMMENT ON TABLE barcodes IS 'Labels printed for orders/items/packages. Scans are recorded as order_status_history rows (source = scanner), not here.';

CREATE TABLE order_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- generated on the device => idempotent replays
  branch_id   uuid NOT NULL REFERENCES branches(id),
  order_id    uuid NOT NULL,
  from_status text,
  to_status   text NOT NULL CHECK (to_status IN
                ('pending','received','in_design','awaiting_approval','printing','finishing','ready','out_for_delivery','delivered','cancelled')),
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','scanner','system','web','sync_resolution')),
  barcode_id  uuid,
  changed_by  uuid REFERENCES users(id),
  note        text,
  device_id   text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),  -- when it happened on the device (may be offline)
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),  -- when the server stored it
  updated_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT osh_order_fk   FOREIGN KEY (order_id, branch_id)   REFERENCES orders (id, branch_id),
  CONSTRAINT osh_barcode_fk FOREIGN KEY (barcode_id, branch_id) REFERENCES barcodes (id, branch_id)
);
CREATE INDEX osh_order_idx ON order_status_history (order_id, occurred_at);
CREATE INDEX osh_sync_idx  ON order_status_history (branch_id, updated_at, id);
CALL attach_sync_trigger('order_status_history');
CALL attach_append_only('order_status_history');
COMMENT ON TABLE order_status_history IS 'Append-only audit trail of status changes; also the offline "event" that the server validates against the transition rules.';
