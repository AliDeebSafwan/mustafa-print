-- 0027_b2b_accounts.sql : B2B accounts build on customer_type/company_name, already on customers since 0003.
-- A "company" is a customer marked customer_type = 'b2b' with company_name set; there is no separate company table,
-- matching the design already implied by those two columns — one business is one customer record, not a group of
-- linked contacts.

ALTER TABLE customers ADD COLUMN tax_number text;
ALTER TABLE customers ADD COLUMN credit_limit numeric(14,2) CHECK (credit_limit >= 0);   -- null: no limit
COMMENT ON COLUMN customers.credit_limit IS 'Highest total the shop lets this customer owe across all unpaid orders before staff must override. Null: unlimited, the default for everyone.';

-- A company's own agreed price for a product, overriding the catalogue's base price when staff order for them.
-- Advisory on the device (a suggested price staff may still adjust) and re-quoted server-side only where it already
-- matters: the consolidated invoice totals what the order itself recorded, never a separately recomputed number.
CREATE TABLE company_price_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id),
  customer_id  uuid NOT NULL,
  product_id   uuid NOT NULL,
  unit_price   numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at   timestamptz,
  row_version  integer NOT NULL DEFAULT 1,
  CONSTRAINT company_price_overrides_customer_fk FOREIGN KEY (customer_id, branch_id) REFERENCES customers (id, branch_id),
  CONSTRAINT company_price_overrides_product_fk FOREIGN KEY (product_id, branch_id) REFERENCES products (id, branch_id)
);
CREATE UNIQUE INDEX company_price_overrides_uq ON company_price_overrides (customer_id, product_id) WHERE deleted_at IS NULL;
CALL attach_sync_trigger('company_price_overrides');

-- One invoice covering several of a company's orders over a period, with its own gap-free number — a different
-- series from a single order's invoice_number, so a shop using both never has two documents sharing a number.
CREATE TABLE company_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  customer_id     uuid NOT NULL,
  invoice_number  bigint NOT NULL,
  currency        char(3) NOT NULL,
  subtotal        numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total           numeric(14,2) NOT NULL CHECK (total >= 0),
  order_count     integer NOT NULL CHECK (order_count > 0),
  issued_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  issued_by       uuid REFERENCES users(id),
  CONSTRAINT company_invoices_customer_fk FOREIGN KEY (customer_id, branch_id) REFERENCES customers (id, branch_id),
  CONSTRAINT company_invoices_total_consistent CHECK (total = subtotal + tax_total)
);
CREATE UNIQUE INDEX company_invoices_number_uq ON company_invoices (branch_id, invoice_number);
CALL attach_append_only('company_invoices');   -- a consolidated invoice, once issued, is exactly as immutable as a per-order one

-- Which consolidated invoice, if any, an order was billed on. An order keeps its own invoice_number only if it was
-- ALSO invoiced individually before joining a consolidated one; the two are independent, not exclusive.
ALTER TABLE orders ADD COLUMN company_invoice_id uuid REFERENCES company_invoices(id);
CREATE INDEX orders_company_invoice_idx ON orders (company_invoice_id) WHERE company_invoice_id IS NOT NULL;
