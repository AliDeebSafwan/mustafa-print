import { defineConfig } from 'vitest/config'

// Needs TEST_DATABASE_URL (a PostgreSQL server where the role may CREATE DATABASE); the tests skip themselves without it.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000 } })
