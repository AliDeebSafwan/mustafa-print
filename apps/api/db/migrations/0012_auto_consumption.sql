-- 0012_auto_consumption.sql : deduct materials automatically when a job starts printing
--
-- The key is the status change that caused it, not the order line. A job sent BACK to the press (finishing ->
-- printing) is a reprint: it really does eat more paper, so it deducts again. Replaying the same status change
-- does not, because it carries the same event id.

ALTER TABLE stock_movements ADD COLUMN source_event_id uuid REFERENCES order_status_history(id);

CREATE UNIQUE INDEX stock_movements_auto_bom_uq
  ON stock_movements (order_item_id, item_id, source_event_id)
  WHERE reason = 'auto:bom';

COMMENT ON COLUMN stock_movements.source_event_id IS
  'The order_status_history entry that caused an automatic deduction. Makes a replay harmless while still allowing a reprint to consume again.';
