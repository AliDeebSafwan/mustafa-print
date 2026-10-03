import pg from 'pg';

/** Minimal shape shared by pg.Pool and pg.PoolClient, so services work inside or outside a transaction. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

/**
 * `onError` is required, not a convenience: pg emits on the POOL when an IDLE connection fails — the database restarted,
 * a failover happened, an administrator terminated the backend, a network path dropped — and with no listener Node
 * treats it as an uncaught exception and ends the process. The pool reconnects by itself on the next query, so dying
 * over it would take the whole counter down for something that had already healed. Making it a parameter means a new
 * caller cannot start a pool that crashes the process on the first blip.
 */
export function createPool(connectionString: string, onError: (err: Error) => void): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  pool.on('error', onError);
  return pool;
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
