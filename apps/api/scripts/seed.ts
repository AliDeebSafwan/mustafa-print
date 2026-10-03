/**
 * Idempotent seed: system roles (from @mpe/shared), the default branch, the first admin, default message templates.
 * Re-running never overwrites shop edits to templates and never resets an existing admin password.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv({ quiet: true });
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { ROLE_DEFINITIONS } from '@mpe/shared';
import { isLeakedSecret, LEAKED_SECRET_MESSAGE } from '../src/config/env';
import { ensureDefaultTemplates } from '../src/modules/messaging/default-templates';

const env = process.env;
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const adminEmail = env.SEED_ADMIN_EMAIL;
const adminPassword = env.SEED_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD');
if (adminPassword.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
// The owner's account is the one that can do everything; never create it with a password the repository has published.
if (isLeakedSecret(adminPassword)) throw new Error(`SEED_ADMIN_PASSWORD: ${LEAKED_SECRET_MESSAGE}`);

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');

  for (const r of ROLE_DEFINITIONS) {
    await client.query(
      `INSERT INTO roles (key, name_ar, name_en, permissions, is_system) VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (key) DO UPDATE SET name_ar = EXCLUDED.name_ar, name_en = EXCLUDED.name_en, permissions = EXCLUDED.permissions, is_system = true`,
      [r.key, r.name_ar, r.name_en, [...r.permissions]],
    );
  }

  const code = env.DEFAULT_BRANCH_CODE ?? 'MAIN';
  const branch = await client.query<{ id: string }>(
    `INSERT INTO branches (code, name_ar, name_en, timezone) VALUES ($1, 'الفرع الرئيسي', 'Main Branch', $2)
     ON CONFLICT (lower(code)) WHERE deleted_at IS NULL DO UPDATE SET code = branches.code
     RETURNING id`,
    [code, env.SEED_BRANCH_TIMEZONE ?? 'UTC'],
  );
  const branchId = branch.rows[0]!.id;

  const existing = await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL', [adminEmail]);
  if (existing.rowCount === 0) {
    await client.query(
      `INSERT INTO users (branch_id, role_id, full_name, email, password_hash)
       VALUES ($1, (SELECT id FROM roles WHERE key = 'admin'), $2, $3, $4)`,
      [branchId, env.SEED_ADMIN_NAME ?? 'Administrator', adminEmail, await hash(adminPassword)],
    );
    console.log(`created admin ${adminEmail}`);
  }

  const inserted = await ensureDefaultTemplates(client);
  console.log(`seed complete: branch ${code}, ${inserted} new template(s)`);
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}
