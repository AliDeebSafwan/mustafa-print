/**
 *   pnpm db:migrate               apply pending migrations
 *   pnpm db:migrate -- --status   list pending migrations without applying
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate';
import { ensureDefaultTemplates } from '../src/modules/messaging/default-templates';

loadDotenv({ quiet: true });
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const dryRun = process.argv.includes('--status');
  // Resolved from where the command runs (apps/api in development, /app in the image), not from this file,
  // which moves when it is bundled into dist/.
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'db/migrations');
  const report = await runMigrations(client, { dir, dryRun, log: console.log });
  if (dryRun) console.log(report.pending.length ? report.pending.map((f) => `pending  ${f}`).join('\n') : 'no pending migrations');
  else {
    console.log(report.applied.length ? `done: ${report.applied.length} migration(s) applied` : 'database is up to date');
    // New versions may bring new default messages; add the missing ones without touching the shop's edits.
    const added = await ensureDefaultTemplates(client);
    if (added > 0) console.log(`added ${added} new default message(s)`);
  }
} finally {
  await client.end();
}
