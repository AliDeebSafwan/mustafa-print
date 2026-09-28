import { z } from 'zod';
import { HttpError } from '../../http-error';

/**
 * Pull position, one entry per table: the (timestamp, id) of the last row already delivered.
 * Timestamps keep microsecond precision (as text) so a row is never skipped or re-sent because of rounding.
 */
export interface TablePosition { ts: string; id: string }
export type Cursor = Record<string, TablePosition>;

export const EPOCH: TablePosition = { ts: '1970-01-01T00:00:00.000000Z', id: '00000000-0000-0000-0000-000000000000' };

const positionSchema = z.object({
  ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/),
  id: z.string().uuid(),
});
const cursorSchema = z.object({ v: z.literal(1), t: z.record(z.string(), positionSchema) });

export const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify({ v: 1, t: cursor })).toString('base64url');

export function decodeCursor(encoded: string | undefined): Cursor {
  if (!encoded) return {};
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).t;
  } catch {
    throw new HttpError(400, 'invalid_cursor', 'The sync cursor is malformed; start again without a cursor');
  }
}
