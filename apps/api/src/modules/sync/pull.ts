import type { Pool } from 'pg';
import { hasPermission, type PullQuery, type PullResponse } from '@mpe/shared';
import type { AuthContext } from '../auth/types';
import { decodeCursor, encodeCursor, EPOCH, type Cursor, type TablePosition } from './cursor';
import { PULL_TABLES, type PullTable } from './pull-tables';

type Row = Record<string, unknown> & { id: string; sync_ts: Date; _cursor_ts: string };

async function fetchPage(pool: Pool, table: PullTable, auth: AuthContext, after: TablePosition, lagSeconds: number, limit: number): Promise<Row[]> {
  const { sql, params } = table.source(auth);
  const n = params.length;
  const { rows } = await pool.query<Row>(
    `SELECT s.*, to_char(s.sync_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS _cursor_ts
       FROM (${sql}) s
      WHERE (s.sync_ts, s.id) > ($${n + 1}::timestamptz, $${n + 2}::uuid)
        AND s.sync_ts <= clock_timestamp() - make_interval(secs => $${n + 3})
      ORDER BY s.sync_ts, s.id
      LIMIT $${n + 4}`,
    [...params, after.ts, after.id, lagSeconds, limit],
  );
  return rows;
}

const toClientRow = ({ sync_ts: _ts, _cursor_ts: _cursor, ...row }: Row): Record<string, unknown> => row;

/**
 * Everything that changed since the cursor, for the tables this caller may read, in at most `limit` rows.
 *
 * Rows newer than `lagSeconds` are held back. A transaction that started earlier but commits a moment later would
 * otherwise carry a timestamp BEHIND a cursor that already moved on, and its rows would be skipped forever.
 * The lag only has to exceed the longest write transaction (they take milliseconds here).
 */
export async function pullChanges(deps: { pool: Pool; lagSeconds: number }, auth: AuthContext, query: PullQuery): Promise<PullResponse> {
  const cursor = decodeCursor(query.cursor);
  const next: Cursor = { ...cursor };
  const changes: PullResponse['changes'] = {};
  let remaining = query.limit;
  let hasMore = false;

  for (const table of PULL_TABLES) {
    if (!table.readAny.some((permission) => hasPermission(auth.role.permissions, permission))) continue;
    if (remaining === 0) { hasMore = true; break; }

    const rows = await fetchPage(deps.pool, table, auth, cursor[table.entity] ?? EPOCH, deps.lagSeconds, remaining + 1);
    if (rows.length > remaining) { hasMore = true; rows.length = remaining; }
    const last = rows.at(-1);
    if (!last) continue;

    changes[table.entity] = rows.map(toClientRow);
    next[table.entity] = { ts: last._cursor_ts, id: last.id };
    remaining -= rows.length;
  }
  return { changes, cursor: encodeCursor(next), hasMore };
}
