import { randomUUID } from 'node:crypto';
import { MAX_CURSOR_LENGTH, READ_ONLY_ENTITIES, SYNC_ENTITIES } from '@mpe/shared';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, type Cursor } from '../src/modules/sync/cursor';
import { PULL_TABLES } from '../src/modules/sync/pull-tables';

const position = () => ({ ts: '2026-09-20T08:31:36.123456Z', id: randomUUID() });

describe('sync cursor', () => {
  it('round-trips and treats "no cursor" as "from the beginning"', () => {
    const cursor: Cursor = { customers: position(), orders: position() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(undefined)).toEqual({});
  });

  it('stays far below the request limit even with a position for EVERY synced table', () => {
    const everyTable = Object.fromEntries(PULL_TABLES.map((t) => [t.entity, position()]));
    const size = encodeCursor(everyTable).length;
    expect(size).toBeLessThan(MAX_CURSOR_LENGTH / 2);      // regression: this once exceeded a 200 character limit
  });

  it('rejects tampered or foreign values instead of guessing', () => {
    const bad = [
      'not-base64-json',
      Buffer.from('{"v":2,"t":{}}').toString('base64url'),
      Buffer.from('{"v":1,"t":{"orders":{"ts":"yesterday","id":"x"}}}').toString('base64url'),
      Buffer.from('{"v":1,"t":{"orders":{"ts":"2026-01-01T00:00:00Z","id":"1; DROP TABLE orders"}}}').toString('base64url'),
    ];
    for (const value of bad) expect(() => decodeCursor(value)).toThrow(/malformed/);
  });
});

describe('the pull registry and the shared contract stay in step', () => {
  it('every table the server sends is named in the shared entity lists (otherwise clients silently drop it)', () => {
    const known = new Set<string>([...SYNC_ENTITIES, ...READ_ONLY_ENTITIES]);
    expect(PULL_TABLES.map((t) => t.entity).filter((e) => !known.has(e))).toEqual([]);
  });

  it('and nothing is listed as read-only that the server never sends', () => {
    const sent = new Set(PULL_TABLES.map((t) => t.entity));
    expect(READ_ONLY_ENTITIES.filter((e) => !sent.has(e))).toEqual([]);
  });
});
