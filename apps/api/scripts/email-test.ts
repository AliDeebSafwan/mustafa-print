/**
 * Sends one test email through the configured provider and prints exactly what the provider answered.
 * Usage: pnpm --filter @mpe/api email:test you@example.com
 * Reads the same .env as the API. Never prints the API key itself.
 */
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { getEnv } from '../src/config/env';
import { buildProviders } from '../src/modules/messaging/providers';

const to = process.argv[2];
if (!to || !to.includes('@')) {
  console.error('Usage: pnpm --filter @mpe/api email:test you@example.com');
  process.exit(1);
}

let env;
try {
  env = getEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const key = env.RESEND_API_KEY ?? '';
console.log(`EMAIL_PROVIDER = ${env.EMAIL_PROVIDER}`);
console.log(`EMAIL_FROM     = ${env.EMAIL_FROM ?? '(not set)'}`);
console.log(`RESEND_API_KEY = ${key ? `set, ${key.length} characters, ${key.startsWith('re_') ? 'starts with re_' : 'does NOT start with re_ (check for a copy mistake)'}` : '(not set)'}`);
if (env.EMAIL_PROVIDER !== 'resend') {
  console.log('\nEMAIL_PROVIDER is not "resend": nothing is sent, the email is only printed. Set EMAIL_PROVIDER=resend in apps/api/.env.');
}

const mailer = buildProviders(env, pino({ level: 'info' })).get('email')!;
const result = await mailer.send({
  logId: randomUUID(), channel: 'email', to, locale: 'en',
  subject: 'Mustafa Print: test email', body: 'If you can read this, email delivery from the website works.',
});

if (result.ok && result.provider === 'console') {
  console.log('\nNot sent: printed above only (console mode).');
} else if (result.ok) {
  console.log(`\nOK: accepted by ${result.provider} (id ${result.providerMessageId}). Check the inbox and the spam folder of ${to}.`);
} else {
  console.log(`\nREFUSED by ${result.provider}: ${result.code} - ${result.message}`);
  process.exit(1);
}
