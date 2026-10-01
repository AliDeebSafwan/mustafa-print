/**
 * Recovery for a staff account (the admin included) that can no longer sign in: wrong or forgotten password, or
 * locked after too many failed attempts. Needs direct access to the database, so it is only for whoever runs the server.
 *
 *   pnpm --filter @mpe/api staff:reset-password                    lists the staff accounts
 *   pnpm --filter @mpe/api staff:reset-password owner@example.com  asks for a new password, then sets it
 *
 * The password is typed at a hidden prompt, never on the command line (it would stay in the shell history).
 * Setting it also lifts any sign-in lock and signs that person out everywhere else.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv({ quiet: true });
import pg from 'pg';
import { createInterface } from 'node:readline';
import { PASSWORD_MAX, PASSWORD_MIN } from '@mpe/shared';
import { hashPassword } from '../src/modules/auth/password';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (run this from the project, with apps/api/.env in place).');
  process.exit(1);
}

/** Reads one line without showing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void };
    let prompted = false;
    output._writeToOutput = (s: string) => {
      if (!prompted) { process.stdout.write(s); prompted = true; }   // the question itself, then nothing
    };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const email = process.argv[2]?.trim().toLowerCase();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  if (!email) {
    const { rows } = await client.query<{ email: string | null; phone_e164: string | null; role: string; is_active: boolean; locked: boolean }>(
      `SELECT u.email, u.phone_e164, r.key AS role, u.is_active,
              EXISTS (SELECT 1 FROM login_failures f WHERE f.identifier IN (lower(u.email), u.phone_e164) AND f.locked_until > clock_timestamp()) AS locked
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.deleted_at IS NULL ORDER BY r.key, u.email`);
    if (!rows.length) console.log('No staff accounts yet: run pnpm db:seed to create the first admin.');
    for (const r of rows) {
      console.log(`${r.role.padEnd(18)} ${(r.email ?? r.phone_e164 ?? '').padEnd(36)} ${r.is_active ? '' : '(deactivated) '}${r.locked ? '(locked: too many failed attempts)' : ''}`);
    }
    console.log('\nTo set a new password: pnpm --filter @mpe/api staff:reset-password <email>');
  } else {
    const { rows } = await client.query<{ id: string; is_active: boolean; phone_e164: string | null }>(
      'SELECT id, is_active, phone_e164 FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [email]);
    const user = rows[0];
    if (!user) {
      console.error(`No staff account with the email ${email}. Run the command without an email to list them.`);
      process.exitCode = 1;
    } else {
      const password = await askHidden(`New password for ${email} (at least ${PASSWORD_MIN} characters): `);
      const again = await askHidden('Type it again: ');
      if (password !== again) {
        console.error('The two passwords are different. Nothing was changed.');
        process.exitCode = 1;
      } else if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        console.error(`The password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters. Nothing was changed.`);
        process.exitCode = 1;
      } else {
        const hash = await hashPassword(password);
        await client.query('BEGIN');
        await client.query('UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1', [user.id, hash]);
        await client.query('DELETE FROM login_failures WHERE identifier = ANY($1)', [[email, user.phone_e164].filter(Boolean)]);
        await client.query('COMMIT');
        console.log(`Password changed for ${email}; any sign-in lock is lifted. Sign in at the staff app with the new password.`);
        if (!user.is_active) console.log('Note: this account is deactivated. Another admin must reactivate it from the Team screen.');
      }
    }
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw err;
} finally {
  await client.end();
}
