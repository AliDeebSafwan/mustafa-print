-- 0021_sync_edit_items_op.sql : the op CHECK must accept the new mutation kind before any device can send one
ALTER TABLE client_mutations DROP CONSTRAINT client_mutations_op_check;
ALTER TABLE client_mutations ADD CONSTRAINT client_mutations_op_check
  CHECK (op IN ('insert','update','delete','status_change','stock_movement','settle','manual_send','edit_items'));
