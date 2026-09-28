-- 0019_sync_manual_send_op.sql : allow the "manual_send" mutation (a message staff typed themselves)
-- The list of ops is mirrored in packages/shared/src/sync.ts (mutationSchema.op); a test keeps the two in step.

ALTER TABLE client_mutations DROP CONSTRAINT client_mutations_op_check;
ALTER TABLE client_mutations ADD CONSTRAINT client_mutations_op_check
  CHECK (op IN ('insert','update','delete','status_change','stock_movement','settle','manual_send'));
