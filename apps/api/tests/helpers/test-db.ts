import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../src/db/migrate';

/**
 * Integration tests get a FRESH, fully migrated database each (dropped afterwards), so they never depend on leftovers
 * and can run in parallel. TEST_DATABASE_URL must point at a server where this role may CREATE DATABASE, e.g.
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres
 */
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export interface TestDatabase { pool: pg.Pool; url: string; drop(): Promise<void> }

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error('TEST_DATABASE_URL is not set');
  const name = `mpe_test_${randomBytes(6).toString('hex')}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const target = new URL(adminUrl);
  target.pathname = `/${name}`;
  const url = target.toString();

  const migrator = new pg.Client({ connectionString: url });
  await migrator.connect();
  await runMigrations(migrator);
  await migrator.end();

  const pool = new pg.Pool({ connectionString: url, max: 8 });
  return {
    pool,
    url,
    async drop() {
      await pool.end();
      const cleaner = new pg.Client({ connectionString: adminUrl });
      await cleaner.connect();
      await cleaner.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleaner.end();
    },
  };
}
