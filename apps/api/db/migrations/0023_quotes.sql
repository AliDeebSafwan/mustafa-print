-- 0023_quotes.sql : quotes the customer accepts from a link, becoming an order at exactly the quoted prices
--
-- Prices and tax are fixed when the quote is issued and copied as-is into the order on acceptance: that is what the
-- customer agreed to, even if the catalogue changes in the meantime. The link carries an unguessable code, like an
-- order's tracking code; holding it only lets someone accept an order at the agreed price for that customer.

CREATE TABLE quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  quote_number    bigint NOT NULL,
  public_code     text NOT NULL CHECK (public_code ~ '^[0-9A-HJKMNP-TV-Z]{10,16}$'),
  customer_id     uuid NOT NULL,
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'declined', 'cancelled')),
  currency        char(3) NOT NULL,
  subtotal        numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_total  numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total           numeric(14,2) NOT NULL CHECK (total >= 0),
  valid_until     timestamptz NOT NULL,
  notes           text,                 -- shown to the customer
  internal_notes  text,                 -- staff only
  decline_reason  text,
  order_id        uuid,
  accepted_at     timestamptz,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at      timestamptz,
  row_version     integer NOT NULL DEFAULT 1,
  CONSTRAINT quotes_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT quotes_customer_fk FOREIGN KEY (customer_id, branch_id) REFERENCES customers (id, branch_id),
  CONSTRAINT quotes_order_fk FOREIGN KEY (order_id, branch_id) REFERENCES orders (id, branch_id),
  CONSTRAINT quotes_total_consistent CHECK (total = subtotal - discount_total + tax_total),
  CONSTRAINT quotes_accepted_has_order CHECK ((status = 'accepted') = (order_id IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX quotes_public_code_uq ON quotes (public_code);
CREATE UNIQUE INDEX quotes_number_uq ON quotes (branch_id, quote_number);
CREATE INDEX quotes_branch_idx ON quotes (branch_id, created_at DESC) WHERE deleted_at IS NULL;
CALL attach_sync_trigger('quotes');
COMMENT ON TABLE quotes IS 'Priced offers the customer accepts by link; acceptance creates an order with the same items and prices.';

CREATE TABLE quote_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  quote_id       uuid NOT NULL,
  product_id     uuid,
  sort_order     integer NOT NULL DEFAULT 0,
  name_snapshot  text NOT NULL CHECK (length(trim(name_snapshot)) > 0),
  unit           text NOT NULL DEFAULT 'piece',
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price     numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  discount       numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total     numeric(14,2) NOT NULL CHECK (line_total >= 0),
  notes          text,
  CONSTRAINT quote_items_quote_fk FOREIGN KEY (quote_id, branch_id) REFERENCES quotes (id, branch_id) ON DELETE CASCADE
);
CREATE INDEX quote_items_quote_idx ON quote_items (quote_id, sort_order);

-- An order that came from an accepted quote says so.
ALTER TABLE orders DROP CONSTRAINT orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('staff', 'web', 'import', 'quote'));
