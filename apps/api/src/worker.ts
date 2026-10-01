import { getEnv } from './config/env';
import { createPool } from './db/pool';
import { createLogger } from './logger';
import { createAuthService } from './modules/auth/auth.service';
import { createCustomerAuthService } from './modules/customer-auth/customer-auth.service';
import { localDiskStorage } from './modules/media/storage';
import { disabledScanner } from './modules/media/virus-scan';
import { createWebOrderService } from './modules/orders/web-orders.service';
import { authConfigFromEnv } from './modules/auth/config';
import { startOutboxWorker } from './modules/messaging/outbox-worker';
import { buildProviders } from './modules/messaging/providers';
import { createDailySummaryService } from './modules/reports/daily-summary.service';

const env = getEnv();
const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const pool = createPool(env.DATABASE_URL);
const providers = buildProviders(env, log);
const worker = startOutboxWorker({ pool, providers, log, intervalMs: env.WORKER_POLL_INTERVAL_MS, batchSize: env.WORKER_BATCH_SIZE });
// Housekeeping: drop long-expired sessions and stale login-throttle rows.
const auth = createAuthService({ pool, cfg: authConfigFromEnv(env) });
const customerAccounts = createCustomerAuthService({ pool, mailer: providers.get('email')!, siteUrl: env.PUBLIC_WEB_URL, branchCode: env.PUBLIC_BRANCH_CODE, log });
const webOrders = createWebOrderService({ pool, storage: localDiskStorage(env.MEDIA_DIR), scanner: disabledScanner /* the worker never receives uploads */, publicWebUrl: env.PUBLIC_WEB_URL });
const prune = () => Promise.all([auth.pruneExpired(), customerAccounts.pruneExpired(), webOrders.pruneUnattached()])
  .then(([removed]) => log.info(removed, 'auth housekeeping'))
  .catch((err) => log.error({ err }, 'auth housekeeping failed'));
void prune();
const pruneTimer = setInterval(prune, 60 * 60 * 1000);

// The owner's end-of-day email. Checked every minute; a branch's day is claimed atomically, so it goes out once.
const dailySummary = createDailySummaryService({ pool, mailer: providers.get('email')!, log });
const summaryTick = () => dailySummary.sendDue().then((n) => { if (n > 0) log.info({ sent: n }, 'daily summary sent'); }).catch((err) => log.error({ err }, 'daily summary tick failed'));
void summaryTick();
const summaryTimer = setInterval(summaryTick, 60 * 1000);

log.info({ whatsapp: env.WHATSAPP_PROVIDER, email: env.EMAIL_PROVIDER, sms: env.SMS_PROVIDER }, 'messaging worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'worker shutting down');
  clearInterval(pruneTimer);
  clearInterval(summaryTimer);
  await worker.stop();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
