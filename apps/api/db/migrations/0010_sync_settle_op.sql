-- 0010_sync_settle_op.sql : allow the "settle" mutation (handing COD cash over to the shop)
-- The list of ops is mirrored in packages/shared/src/sync.ts (mutationSchema.op); a test keeps the two in step.

ALTER TABLE client_mutations DROP CONSTRAINT client_mutations_op_check;
ALTER TABLE client_mutations ADD CONSTRAINT client_mutations_op_check
  CHECK (op IN ('insert','update','delete','status_change','stock_movement','settle'));
