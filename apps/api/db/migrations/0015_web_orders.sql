-- 0015_web_orders.sql : customers order from the website
--
-- A web order arrives as 'pending'. When it is to be delivered, its fee is not known yet (delivery covers all of
-- Lebanon and the owner prices it per order): `delivery_fee_pending` says so, and the order cannot be confirmed
-- until the owner sets the fee.

ALTER TABLE orders ADD COLUMN delivery_fee_pending boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD CONSTRAINT orders_fee_pending_needs_delivery
  CHECK (NOT delivery_fee_pending OR fulfillment_type = 'delivery');
COMMENT ON COLUMN orders.delivery_fee_pending IS 'The customer asked for delivery and the owner has not priced it yet; the order cannot be confirmed until then.';

-- Design files customers send with an order. Private: never served publicly, only to signed-in staff.
-- A file is uploaded during checkout, before the order exists; it is attached when the order is submitted,
-- and an unattached file is removed after a day.
CREATE TABLE order_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id          uuid NOT NULL REFERENCES branches(id),
  order_id           uuid,
  order_item_id      uuid,
  storage_key        text NOT NULL,
  original_name      text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('pdf', 'jpg', 'png', 'tiff', 'psd', 'zip')),
  bytes              bigint NOT NULL CHECK (bytes > 0),
  uploaded_by_account uuid REFERENCES customer_accounts(id),
  uploaded_by_user    uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at         timestamptz,
  CONSTRAINT order_files_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT order_files_order_fk FOREIGN KEY (order_id, branch_id) REFERENCES orders (id, branch_id),
  CONSTRAINT order_files_item_fk FOREIGN KEY (order_item_id, branch_id) REFERENCES order_items (id, branch_id),
  CONSTRAINT order_files_uploader CHECK (uploaded_by_account IS NOT NULL OR uploaded_by_user IS NOT NULL),
  CONSTRAINT order_files_item_needs_order CHECK (order_item_id IS NULL OR order_id IS NOT NULL)
);
CREATE INDEX order_files_order_idx ON order_files (order_id) WHERE deleted_at IS NULL;
CREATE INDEX order_files_unattached_idx ON order_files (created_at) WHERE order_id IS NULL AND deleted_at IS NULL;
COMMENT ON TABLE order_files IS 'Customers'' design files. Private; attached to an order at checkout; unattached uploads expire after a day.';
