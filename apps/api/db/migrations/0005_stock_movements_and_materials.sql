-- 0005_stock_movements_and_materials.sql : append-only stock ledger + bill of materials

CREATE TABLE stock_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- device-generated => idempotent
  branch_id      uuid NOT NULL REFERENCES branches(id),
  item_id        uuid NOT NULL,
  movement_type  text NOT NULL CHECK (movement_type IN
                   ('opening_balance','receipt','consumption','waste','adjustment','transfer_in','transfer_out','return')),
  quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),   -- signed
  unit_cost      numeric(14,4) CHECK (unit_cost >= 0),
  order_id       uuid,
  order_item_id  uuid,
  reason         text,
  occurred_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by     uuid REFERENCES users(id),
  device_id      text,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT stock_movements_item_fk       FOREIGN KEY (item_id, branch_id)       REFERENCES inventory_items (id, branch_id),
  CONSTRAINT stock_movements_order_fk      FOREIGN KEY (order_id, branch_id)      REFERENCES orders (id, branch_id),
  CONSTRAINT stock_movements_order_item_fk FOREIGN KEY (order_item_id, branch_id) REFERENCES order_items (id, branch_id),
  CONSTRAINT stock_movements_sign CHECK (
       (movement_type IN ('opening_balance','receipt','transfer_in','return') AND quantity_delta > 0)
    OR (movement_type IN ('consumption','waste','transfer_out')               AND quantity_delta < 0)
    OR  movement_type = 'adjustment')
);
CREATE INDEX stock_movements_item_idx  ON stock_movements (item_id, occurred_at DESC);
CREATE INDEX stock_movements_order_idx ON stock_movements (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX stock_movements_sync_idx  ON stock_movements (branch_id, updated_at, id);
CALL attach_sync_trigger('stock_movements');
CALL attach_append_only('stock_movements');
COMMENT ON TABLE stock_movements IS 'Append-only inventory ledger. Deltas commute, so two offline devices never conflict; fix mistakes with a compensating movement.';

CREATE FUNCTION apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.stock_trigger', 'on', true);
  UPDATE inventory_items
     SET quantity_on_hand = quantity_on_hand + NEW.quantity_delta
   WHERE id = NEW.item_id AND branch_id = NEW.branch_id;
  PERFORM set_config('app.stock_trigger', '', true);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_apply_stock_movement AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

CREATE TABLE product_materials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES branches(id),
  product_id        uuid NOT NULL,
  item_id           uuid NOT NULL,
  quantity_per_unit numeric(14,6) NOT NULL CHECK (quantity_per_unit > 0),  -- inventory units per ONE product unit
  waste_pct         numeric(5,2) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  option_match      jsonb,      -- NULL = always applies; {"paper":"gloss-250"} = only if order_item.options @> this
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at        timestamptz,
  row_version       integer NOT NULL DEFAULT 1,
  CONSTRAINT product_materials_product_fk FOREIGN KEY (product_id, branch_id) REFERENCES products (id, branch_id),
  CONSTRAINT product_materials_item_fk    FOREIGN KEY (item_id, branch_id)    REFERENCES inventory_items (id, branch_id)
);
CREATE INDEX product_materials_product_idx ON product_materials (product_id) WHERE deleted_at IS NULL;
CREATE INDEX product_materials_sync_idx    ON product_materials (branch_id, updated_at, id);
CALL attach_sync_trigger('product_materials');
COMMENT ON TABLE product_materials IS 'Bill of materials used for automatic stock deduction: consumption = quantity x quantity_per_unit x (1 + waste_pct/100).';
