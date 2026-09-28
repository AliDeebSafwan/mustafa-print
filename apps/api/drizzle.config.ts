import { defineConfig } from 'drizzle-kit';

// SQL migrations in db/migrations are the source of truth. `pnpm db:pull` regenerates the typed schema from
// a migrated database into ./.drizzle-pull; copy schema.ts to src/db/schema.ts when the tables change.
export default defineConfig({
  dialect: 'postgresql',
  out: './.drizzle-pull',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
