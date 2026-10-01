import { createApp } from './app';
import { getEnv } from './config/env';
import { createPool } from './db/pool';
import { createLogger } from './logger';

const env = getEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const pool = createPool(env.DATABASE_URL);
if (env.NODE_ENV === 'production' && env.EMAIL_PROVIDER !== 'resend') {
  // Without a real mail provider, customers cannot confirm their email or reset a password, and the console
  // provider would print their one-time links into the logs, where anyone reading logs could use them.
  log.warn('EMAIL_PROVIDER is not "resend": customer sign-up emails are NOT delivered and their links appear in the logs. Configure email before opening accounts to customers.');
}
if (env.NODE_ENV !== 'production' && env.EMAIL_PROVIDER === 'console') {
  // The most common "the email never came" during development: it was printed here instead.
  log.info('EMAIL_PROVIDER=console: emails are printed in this log (look for "console provider"), not sent. Order emails are printed by the worker (pnpm dev:worker).');
}

const server = createApp({ pool, env, log }).app.listen(env.PORT, () => log.info({ port: env.PORT }, 'api listening'));

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
