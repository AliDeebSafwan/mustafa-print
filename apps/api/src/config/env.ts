import { config as loadDotenv } from 'dotenv';
loadDotenv({ quiet: true });
import { z } from 'zod';
// The first zod user on the server, so the no-code-generation rule starts here (see packages/shared/src/util/zod-setup.ts).
z.config({ jitless: true });

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * JWT secrets that have been published in this repository's example files. They are public knowledge, so anyone could
 * sign their own admin token with them: a production server must never start with one.
 */
const PUBLISHED_EXAMPLE_SECRETS = new Set(['1q2w3e4r5t6y7u8i9o0p1a2s3d4f5g6h7j8k9l0zxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM']);

/** A real public address: https, and not this machine. Dev defaults (http://localhost) must never reach production. */
function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname);
  } catch {
    return false;
  }
}

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173').transform(csv),
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
    /** Signs access tokens (HS256). Generate with: openssl rand -base64 48 */
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Defaults to true in production. Set false only for plain-http local testing. */
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    /** Rows changed in the last N seconds are held back from pulls so a slow commit is never skipped. */
    SYNC_PULL_LAG_SECONDS: z.coerce.number().int().min(0).max(60).default(5),

    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),

    WHATSAPP_PROVIDER: z.enum(['console', 'cloud']).default('console'),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),

    EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    SMS_PROVIDER: z.enum(['console', 'none']).default('none'),

    /** Web Push for staff, alerting whoever is subscribed to a new web order — no Meta approval needed, unlike WhatsApp.
     *  Generate a pair once with `npx web-push generate-vapid-keys` and keep it forever: it identifies this server to
     *  browsers' push services, and rotating it silently unsubscribes everyone. */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),   // mailto: address or https: URL, per the Web Push spec

    /** The branch whose services, showroom and products the public website shows. */
    PUBLIC_BRANCH_CODE: z.string().min(1).default('MAIN'),
    /** Where uploaded pictures are kept on the server. Back this directory up with the database. */
    MEDIA_DIR: z.string().min(1).default('./storage/media'),
    /** A running ClamAV daemon (clamd). Set the host to scan every customer design and proof; leave it empty to skip
     *  scanning. With a host set, an upload the scanner cannot check is refused, never accepted unchecked. */
    CLAMAV_HOST: z.string().optional(),   // blank (an empty line in .env) means off, like every other optional setting
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
    /** The website's revalidation endpoint, called after content changes so edits appear at once (optional). */
    WEB_REVALIDATE_URL: z.string().url().optional(),
    WEB_REVALIDATE_SECRET: z.string().min(24).optional(),
  })
  .superRefine((v, ctx) => {
    const need = (cond: boolean, keys: string[]) => {
      if (!cond) return;
      for (const k of keys) {
        if (!(v as Record<string, unknown>)[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required for the selected provider` });
      }
    };
    need(v.WHATSAPP_PROVIDER === 'cloud', ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN']);
    need(v.EMAIL_PROVIDER === 'resend', ['RESEND_API_KEY', 'EMAIL_FROM']);
    need(Boolean(v.WEB_REVALIDATE_URL), ['WEB_REVALIDATE_SECRET']);
    need(Boolean(v.VAPID_PUBLIC_KEY || v.VAPID_PRIVATE_KEY), ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);

    // A wildcard with credentialed requests is never valid CORS, and would read as "any site" to whoever edits this.
    if (v.CORS_ORIGINS.includes('*')) ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'list the allowed origins; "*" is not allowed' });

    if (v.NODE_ENV !== 'production') return;
    if (PUBLISHED_EXAMPLE_SECRETS.has(v.JWT_ACCESS_SECRET)) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'is the published example value; generate your own with: openssl rand -base64 48' });
    }
    // A real deployment serves over https. The development defaults point at http://localhost, so without this check a
    // server whose .env forgot these settings would start "fine" and send customers tracking links to localhost. Local
    // production-mode testing over plain http stays possible by saying so explicitly: COOKIE_SECURE=false.
    const insecureOptOut = v.COOKIE_SECURE === 'false';
    if (insecureOptOut) return;
    if (!isPublicHttpsUrl(v.PUBLIC_WEB_URL)) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_WEB_URL'], message: 'must be the website\'s public https address in production (e.g. https://example.com)' });
    }
    const badOrigins = v.CORS_ORIGINS.filter((origin) => !isPublicHttpsUrl(origin));
    if (badOrigins.length) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `must list public https origins in production; not: ${badOrigins.join(', ')}` });
    }
  })
  .transform((v) => ({ ...v, COOKIE_SECURE: v.COOKIE_SECURE ? v.COOKIE_SECURE === 'true' : v.NODE_ENV === 'production' }));

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

let cached: Env | undefined;
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
