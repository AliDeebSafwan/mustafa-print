import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: unit tests do not need the PWA plugin.
// Logic tests run in plain node; tests/ui/*.test.tsx opt into jsdom with a "@vitest-environment jsdom" comment.
export default defineConfig({ esbuild: { jsx: 'automatic' }, test: { include: ['tests/**/*.test.{ts,tsx}'], environment: 'node' } })
