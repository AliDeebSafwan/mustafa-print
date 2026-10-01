import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Agent } from 'node:https';
import { pinoHttp } from 'pino-http';
import type { Pool } from 'pg';
import type { Env } from './config/env';
import type { Logger } from './logger';
import { HttpError } from './http-error';
import { authConfigFromEnv } from './modules/auth/config';
import { createAuthService } from './modules/auth/auth.service';
import { authenticate } from './modules/auth/middleware';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { createContentService } from './modules/content/content.service';
import { localDiskStorage } from './modules/media/storage';
import { adminContentRouter } from './routes/admin/content';
import { adminTemplatesRouter } from './routes/admin/templates';
import { createCustomerAuthService } from './modules/customer-auth/customer-auth.service';
import { buildProviders } from './modules/messaging/providers';
import type { ChannelProvider } from './modules/messaging/types';
import { customerAccountRouter } from './routes/public/customer-account';
import { createWebOrderService } from './modules/orders/web-orders.service';
import { createClamdScanner, disabledScanner, type FileScanner } from './modules/media/virus-scan';
import { createInvoiceService } from './modules/orders/invoices.service';
import { adminOrdersRouter } from './routes/admin/orders';
import { adminTeamRouter } from './routes/admin/team';
import { adminReportsRouter } from './routes/admin/reports';
import { adminQuotesRouter, publicQuotesRouter } from './routes/quotes';
import { adminProofsRouter, publicProofsRouter } from './routes/proofs';
import { pushRouter } from './routes/admin/push';
import { companyInvoicesRouter } from './routes/admin/company-invoices';
import { createCompanyInvoiceService } from './modules/orders/company-invoices.service';
import { createPushService } from './modules/push/push.service';
import { createProofsService } from './modules/proofs/proofs.service';
import { createQuotesService } from './modules/quotes/quotes.service';
import { adminCustomerAccountsRouter } from './routes/admin/customer-accounts';
import { createCustomerAccountsAdminService } from './modules/customer-auth/customer-accounts-admin.service';
import { createReportsService } from './modules/reports/reports.service';
import { createStaffService } from './modules/staff/staff.service';
import { publicRouter } from './routes/public/order-tracking';
import { publicSiteRouter } from './routes/public/site';
import { syncRouter } from './routes/sync';
import { whatsappWebhookRouter } from './routes/whatsapp-webhook';

/** `mailer` replaces the configured email provider (tests capture the links it would send). */
export function createApp(deps: { pool: Pool; env: Env; log: Logger; mailer?: ChannelProvider; pushAgent?: Agent; pushAllowedHosts?: readonly string[]; scanner?: FileScanner }) {
  const { pool, env, log } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(pinoHttp({ logger: log, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

  // Webhooks first: they need the raw body for signature verification.
  app.use('/webhooks', whatsappWebhookRouter({ pool, log, appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN }));

  app.use(express.json({ limit: '1mb' }));
  const authCfg = authConfigFromEnv(env);
  const authService = createAuthService({ pool, cfg: authCfg });
  const requireLogin = authenticate({ pool, cfg: authCfg });

  app.use(healthRouter(pool));
  const staff = createStaffService({ pool });
  app.use('/api/v1/auth', authRouter({ service: authService, staff, cfg: authCfg, allowedOrigins: env.CORS_ORIGINS, authenticate: requireLogin }));
  const refreshWebsite = websiteRefresher(env, log);
  app.use('/api/v1/admin/team', adminTeamRouter({ staff, authenticate: requireLogin, onPublicChange: refreshWebsite }));
  const reports = createReportsService({ pool });
  app.use('/api/v1/admin/reports', adminReportsRouter({ reports, authenticate: requireLogin }));
  app.use('/api/v1/admin/customer-accounts', adminCustomerAccountsRouter({ accounts: createCustomerAccountsAdminService({ pool }), authenticate: requireLogin }));
  const storage = localDiskStorage(env.MEDIA_DIR);
  const scanner = deps.scanner ?? (env.CLAMAV_HOST ? createClamdScanner({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT, timeoutMs: env.CLAMAV_TIMEOUT_MS }) : disabledScanner);
  if (!scanner.enabled) log.warn('no virus scanner configured (CLAMAV_HOST): uploaded files are checked by type only');
  const content = createContentService({ pool, storage, onPublicChange: refreshWebsite });
  const customers = createCustomerAuthService({
    pool, siteUrl: env.PUBLIC_WEB_URL, branchCode: env.PUBLIC_BRANCH_CODE,
    mailer: deps.mailer ?? buildProviders(env, log).get('email')!, log,
  });
  const push = createPushService({ pool, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT, agent: deps.pushAgent, extraAllowedHosts: deps.pushAllowedHosts });
  app.use('/api/v1/admin/push', pushRouter({ push, authenticate: requireLogin }));
  app.use('/api/v1/admin/company-invoices', companyInvoicesRouter({ invoices: createCompanyInvoiceService({ pool }), authenticate: requireLogin }));
  const webOrders = createWebOrderService({ pool, storage, scanner, publicWebUrl: env.PUBLIC_WEB_URL, push });
  const invoices = createInvoiceService({ pool });
  app.use('/api/v1/public/account', customerAccountRouter({ service: customers, orders: webOrders, cookieSecure: env.COOKIE_SECURE, allowedOrigins: [env.PUBLIC_WEB_URL] }));
  app.use('/api/v1/admin/orders', adminOrdersRouter({ orders: webOrders, invoices, authenticate: requireLogin }));
  app.use('/api/v1/public/site', publicSiteRouter({ pool, content, storage, branchCode: env.PUBLIC_BRANCH_CODE }));
  const quotes = createQuotesService({ pool, publicWebUrl: env.PUBLIC_WEB_URL });
  app.use('/api/v1/admin/quotes', adminQuotesRouter({ quotes, authenticate: requireLogin }));
  app.use('/api/v1/public/quotes', publicQuotesRouter({ quotes }));
  const proofs = createProofsService({ pool, storage, scanner, publicWebUrl: env.PUBLIC_WEB_URL });
  app.use('/api/v1/admin/orders', adminProofsRouter({ proofs, authenticate: requireLogin }));
  app.use('/api/v1/public/proofs', publicProofsRouter({ proofs }));
  app.use('/api/v1/public', publicRouter(pool));
  app.use('/api/v1/admin/content', adminContentRouter({ content, authenticate: requireLogin }));
  app.use('/api/v1/admin/templates', adminTemplatesRouter({ pool, authenticate: requireLogin }));
  app.use('/api/v1/sync', syncRouter({ pool, env, authenticate: requireLogin, onPublicChange: refreshWebsite }));

  app.use((_req, res) => void res.status(404).json({ error: 'not_found' }));
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.set(err.headers).status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_request', message: 'Malformed JSON body' });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);
  return { app, authService, requireLogin, authCfg, customers };
}

/**
 * Tells the website to rebuild its pages after the owner changes something the public sees. Without it the site
 * still catches up within a minute; with it, the change appears at once. A failure is logged, never fatal.
 */
function websiteRefresher(env: Env, log: Logger): () => void {
  const url = env.WEB_REVALIDATE_URL;
  const secret = env.WEB_REVALIDATE_SECRET;
  if (!url || !secret) return () => undefined;
  return () => {
    fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(3000) })
      .then((res) => { if (!res.ok) log.warn({ status: res.status }, 'website refresh refused'); })
      .catch((err: unknown) => log.warn({ err }, 'website refresh failed'));
  };
}
