import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../db/migrations');
const LOCK_KEY = 727001;   // two deploys must never migrate at the same time

export interface MigrationReport { applied: string[]; pending: string[] }

/**
 * Applies pending SQL migrations, each in its own transaction. Applied files are checksummed and must never be edited
 * afterwards (create a new numbered file instead). With `dryRun` nothing is executed: it only reports.
 */
export async function runMigrations(
  client: pg.Client,
  opts: { dir?: string; dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<MigrationReport> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? (() => undefined);

  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);

    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const known = new Map((await client.query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [r.filename, r.checksum]));
    const report: MigrationReport = { applied: [], pending: [] };

    for (const file of files) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = known.get(file);
      if (previous) {
        if (previous !== checksum) throw new Error(`Migration ${file} was modified after being applied. Create a new migration instead.`);
        continue;
      }
      if (opts.dryRun) { report.pending.push(file); continue; }
      log(`applying ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        report.applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return report;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
  }
}
