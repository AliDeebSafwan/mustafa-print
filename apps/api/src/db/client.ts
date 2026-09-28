import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as relations from './relations';
import * as schema from './schema';

/** Typed query builder on top of the shared pg pool. Hot paths (outbox, sync) use plain SQL on purpose. */
export function createDb(pool: Pool) {
  return drizzle({ client: pool, schema: { ...schema, ...relations } });
}
export type Db = ReturnType<typeof createDb>;
export { schema };
