import { defineConfig } from 'tsup';

export default defineConfig({
  // migrate and seed are built too, so the production image runs them with plain node (no tsx, no sources).
  entry: { server: 'src/server.ts', worker: 'src/worker.ts', migrate: 'scripts/migrate.ts', seed: 'scripts/seed.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // @mpe/shared ships TypeScript sources: bundle it instead of resolving it at runtime.
  noExternal: ['@mpe/shared'],
});
