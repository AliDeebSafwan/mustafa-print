-- 0003_customers_products_inventory.sql : Customers, Products, Inventory items

CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           uuid NOT NULL REFERENCES branches(id),
  customer_type       text NOT NULL DEFAULT 'b2c' CHECK (customer_type IN ('b2c','b2b')),
  full_name           text NOT NULL,
  company_name        text,
  phone_e164          text CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email               text,
  address_line        text,
  city                text,
  country_code        char(2),
  locale              text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  -- Messaging consent: WhatsApp policy requires opt-in, so everything defaults to OFF.
  whatsapp_opt_in     boolean NOT NULL DEFAULT false,
  sms_opt_in          boolean NOT NULL DEFAULT false,
  email_opt_in        boolean NOT NULL DEFAULT false,
  preferred_channel   text NOT NULL DEFAULT 'whatsapp' CHECK (preferred_channel IN ('whatsapp','sms','email')),
  consent_recorded_at timestamptz,
  consent_source      text CHECK (consent_source IN ('checkout','in_person','phone','migration')),
  notes               text,
  legacy_id           text,               -- id in the old system (data migration)
  legacy_source       text,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at          timestamptz,
  row_version         integer NOT NULL DEFAULT 1,
  CONSTRAINT customers_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT customers_contact_present CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX customers_phone_uq  ON customers (branch_id, phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX customers_legacy_uq ON customers (branch_id, legacy_source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX customers_email_idx ON customers (branch_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX customers_name_trgm ON customers USING gin (full_name gin_trgm_ops);
CREATE INDEX customers_sync_idx  ON customers (branch_id, updated_at, id);
CALL attach_sync_trigger('customers');
COMMENT ON TABLE customers IS 'Customers of a branch. Notification opt-ins default to false; record consent explicitly.';

CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  sku            text NOT NULL,
  slug           text,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  description_ar text,
  description_en text,
  category       text NOT NULL DEFAULT 'general',
  unit           text NOT NULL DEFAULT 'piece' CHECK (unit IN ('piece','sheet','sqm','meter','set','hour')),
  pricing_model  text NOT NULL DEFAULT 'per_unit' CHECK (pricing_model IN ('fixed','per_unit','per_area','tiered','quote')),
  base_price     numeric(14,4) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  min_quantity   numeric(14,3) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
  options_schema jsonb NOT NULL DEFAULT '{}'::jsonb,   -- selectable options (size, paper, finishing...)
  price_rules    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- quantity tiers / option surcharges
  image_url      text,
  is_active      boolean NOT NULL DEFAULT true,
  is_public      boolean NOT NULL DEFAULT false,       -- visible on the customer website
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at     timestamptz,
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT products_id_branch_uq UNIQUE (id, branch_id)
);
CREATE UNIQUE INDEX products_sku_uq  ON products (branch_id, lower(sku)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_slug_uq ON products (branch_id, slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX products_public_idx ON products (branch_id, sort_order) WHERE is_public AND is_active AND deleted_at IS NULL;
CREATE INDEX products_sync_idx   ON products (branch_id, updated_at, id);
CALL attach_sync_trigger('products');
COMMENT ON TABLE products IS 'Sellable products/services. Prices are USD by default (branch base currency).';

CREATE TABLE inventory_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  sku              text NOT NULL,
  name_ar          text NOT NULL,
  name_en          text NOT NULL,
  category         text NOT NULL CHECK (category IN ('paper','ink','plate','film','packaging','chemical','spare_part','other')),
  unit             text NOT NULL CHECK (unit IN ('sheet','ream','ml','liter','g','kg','piece','meter','roll','box')),
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0,   -- maintained ONLY by stock_movements (guarded below)
  reorder_level    numeric(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  reorder_quantity numeric(14,3) CHECK (reorder_quantity > 0),
  cost_per_unit    numeric(14,4) CHECK (cost_per_unit >= 0),
  supplier_name    text,
  is_active        boolean NOT NULL DEFAULT true,
  legacy_id        text,
  legacy_source    text,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at       timestamptz,
  row_version      integer NOT NULL DEFAULT 1,
  CONSTRAINT inventory_items_id_branch_uq UNIQUE (id, branch_id)
);
CREATE UNIQUE INDEX inventory_items_sku_uq    ON inventory_items (branch_id, lower(sku)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX inventory_items_legacy_uq ON inventory_items (branch_id, legacy_source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX inventory_items_low_stock_idx    ON inventory_items (branch_id) WHERE is_active AND deleted_at IS NULL AND quantity_on_hand <= reorder_level;
CREATE INDEX inventory_items_sync_idx         ON inventory_items (branch_id, updated_at, id);
CALL attach_sync_trigger('inventory_items');
COMMENT ON TABLE inventory_items IS 'Raw materials (paper, ink, plates...). quantity_on_hand is derived from stock_movements; may go negative when offline devices race (raise an alert, do not block).';

-- Guard: quantity_on_hand can only change through the stock_movements trigger.
CREATE FUNCTION guard_inventory_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity_on_hand <> 0 THEN
      RAISE EXCEPTION 'inventory_items must start at 0; add an opening_balance stock movement instead';
    END IF;
  ELSIF NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand
        AND coalesce(current_setting('app.stock_trigger', true), '') <> 'on' THEN
    RAISE EXCEPTION 'quantity_on_hand is derived; insert a stock_movements row instead';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_quantity BEFORE INSERT OR UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION guard_inventory_quantity();
