import { z } from 'zod';

/**
 * Offline sync contract (client <-> API). See docs/DB-DESIGN.md "Offline-first design".
 *
 *  push:  POST /api/v1/sync/push   { deviceId, mutations[] }  -> per-mutation results (idempotent by mutation id)
 *  pull:  GET  /api/v1/sync/pull?cursor=<opaque>&limit=200    -> changed rows since cursor
 *
 * The server is authoritative: it recomputes totals, assigns order numbers, validates status transitions
 * and answers every mutation with a result the client must store.
 */
export const SYNC_ENTITIES = [
  'customers', 'products', 'product_materials', 'inventory_items', 'orders', 'order_items', 'barcodes', 'order_status_history',
  'stock_movements', 'transactions', 'notification_logs', 'company_price_overrides',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/**
 * Tables the device only reads (never writes). This list must match what the server actually sends
 * (apps/api/src/modules/sync/pull-tables.ts); a table nobody pulls does not belong here.
 */
export const READ_ONLY_ENTITIES = ['notification_templates'] as const;
export type ReadOnlyEntity = (typeof READ_ONLY_ENTITIES)[number];

export const mutationSchema = z.object({
  id: z.string().uuid(),                                   // mutation id = idempotency key
  entity: z.enum(SYNC_ENTITIES),
  entityId: z.string().uuid(),
  op: z.enum(['insert', 'update', 'delete', 'status_change', 'stock_movement', 'settle', 'manual_send', 'edit_items']),
  baseVersion: z.number().int().positive().nullable().optional(), // row_version the edit started from
  payload: z.record(z.string(), z.unknown()),
  clientCreatedAt: z.string().datetime(),
});
export type Mutation = z.infer<typeof mutationSchema>;

export const pushRequestSchema = z.object({
  deviceId: z.string().min(8).max(100),
  mutations: z.array(mutationSchema).min(1).max(200),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const mutationResultSchema = z.object({
  id: z.string().uuid(),
  result: z.enum(['applied', 'duplicate', 'conflict', 'rejected']),
  error: z.string().optional(),
  /** Server truth after applying (or the current row when conflict/rejected). */
  row: z.record(z.string(), z.unknown()).optional(),
  /** Table the `row` belongs to. Defaults to the mutation's entity; a status_change answers with the ORDER row (`orders`). */
  rowEntity: z.enum([...SYNC_ENTITIES, ...READ_ONLY_ENTITIES]).optional(),
});
export type MutationResult = z.infer<typeof mutationResultSchema>;

export const pushResponseSchema = z.object({ results: z.array(mutationResultSchema) });
export type PushResponse = z.infer<typeof pushResponseSchema>;

/** The cursor holds one position per synced table (about 130 characters each once encoded); this leaves room to grow. */
export const MAX_CURSOR_LENGTH = 4096;

export const pullQuerySchema = z.object({
  cursor: z.string().max(MAX_CURSOR_LENGTH).optional(),                  // opaque to clients; see apps/api/src/modules/sync/cursor.ts
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

export const pullResponseSchema = z.object({
  /** entity name -> changed rows (snake_case, exactly as stored on the server; deleted rows carry deleted_at). */
  changes: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  cursor: z.string(),
  hasMore: z.boolean(),
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
