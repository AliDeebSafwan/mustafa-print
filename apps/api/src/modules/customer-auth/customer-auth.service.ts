import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { CustomerMe, CustomerOrderSummary, CustomerSignupInput, ReorderItem, customerSignupInput } from '@mpe/shared';
import type { z } from 'zod';
import { withTransaction, type Queryable } from '../../db/pool';
import { HttpError } from '../../http-error';
import { hashPassword, verifyPassword } from '../auth/password';
import type { ChannelProvider } from '../messaging/types';

/**
 * Website accounts for customers: email + password, opaque sessions in an httpOnly cookie.
 *
 * Two rules shape everything here:
 *  - Nothing ever tells a stranger whether an email has an account (sign-up, sign-in and "forgot password" answer
 *    the same way either way). Otherwise the site becomes a list of the shop's customers.
 *  - An account reaches a customer's orders only after its email is verified, because the counter may already have
 *    that customer on file under the same email.
 */
const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MAX_EMAILS_PER_HOUR = 3;

export interface CustomerAuthDeps {
  pool: Pool;
  mailer: ChannelProvider;
  /** The website's public address; links in emails point there. */
  siteUrl: string;
  branchCode: string;
  /** Where a refused email is reported. The person is never told (see the rules above), so this is the only trace. */
  log?: Pick<Logger, 'error'>;
}

interface AccountRow {
  id: string; branch_id: string; email: string; password_hash: string; full_name: string; phone_e164: string | null;
  locale: 'ar' | 'en'; customer_id: string | null; email_verified_at: Date | null; is_active: boolean;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/** System emails, in the customer's language. Short on purpose: they are read on a phone. */
const EMAILS = {
  verify: {
    ar: { subject: 'أكّد بريدك الإلكتروني', body: (name: string, link: string) => `مرحباً ${name}،\n\nلإكمال حسابك وتمكين الطلب من الموقع، افتح هذا الرابط:\n${link}\n\nالرابط صالح 48 ساعة. إن لم تنشئ حساباً فتجاهل هذه الرسالة.` },
    en: { subject: 'Confirm your email', body: (name: string, link: string) => `Hello ${name},\n\nTo finish your account and order from the website, open this link:\n${link}\n\nThe link works for 48 hours. If you did not create an account, ignore this message.` },
  },
  reset: {
    ar: { subject: 'اختر كلمة سر جديدة', body: (name: string, link: string) => `مرحباً ${name}،\n\nلاختيار كلمة سر جديدة افتح هذا الرابط:\n${link}\n\nالرابط صالح ساعة واحدة ويُستعمل مرة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة سرك الحالية لم تتغيّر.` },
    en: { subject: 'Choose a new password', body: (name: string, link: string) => `Hello ${name},\n\nTo choose a new password, open this link:\n${link}\n\nThe link works for one hour, once. If you did not ask for this, ignore this message; your password has not changed.` },
  },
  alreadyRegistered: {
    ar: { subject: 'لديك حساب بالفعل', body: (name: string, link: string) => `مرحباً ${name}،\n\nحاول أحدهم إنشاء حساب بهذا البريد، لكن لديك حساباً بالفعل. سجّل الدخول، أو اختر كلمة سر جديدة من هنا:\n${link}` },
    en: { subject: 'You already have an account', body: (name: string, link: string) => `Hello ${name},\n\nSomeone tried to create an account with this email, but you already have one. Sign in, or choose a new password here:\n${link}` },
  },
} as const;

export type CustomerAuthService = ReturnType<typeof createCustomerAuthService>;

export function createCustomerAuthService({ pool, mailer, siteUrl, branchCode, log }: CustomerAuthDeps) {
  const base = siteUrl.replace(/\/$/, '');

  let branchId: string | null = null;
  async function branch(): Promise<string> {
    if (branchId) return branchId;
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM branches WHERE lower(code) = lower($1) AND deleted_at IS NULL', [branchCode]);
    if (!rows[0]) throw new HttpError(503, 'internal_error', `No branch with code ${branchCode}`);
    return (branchId = rows[0].id);
  }

  async function send(account: Pick<AccountRow, 'email' | 'full_name' | 'locale'>, kind: keyof typeof EMAILS, link: string): Promise<void> {
    const text = EMAILS[kind][account.locale];
    // Providers report a refusal (bad API key, unverified sender domain, rate limit) as a result rather than an error,
    // so it must be checked here, or the email silently never arrives. The person still gets the usual answer: telling
    // them would reveal whether the address has an account. They can ask for a new link once email is fixed.
    // The body is not logged: it holds a one-time sign-in link.
    const result = await mailer.send({ logId: randomUUID(), channel: 'email', to: account.email, locale: account.locale, subject: text.subject, body: text.body(account.full_name, link) });
    if (!result.ok) log?.error({ kind, provider: result.provider, code: result.code, reason: result.message }, 'customer account email was not sent');
  }

  /** A cap on emails per account per hour, so the form cannot be used to flood someone's inbox. */
  async function mayEmail(q: Queryable, accountId: string): Promise<boolean> {
    const { rows } = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM customer_tokens WHERE account_id = $1 AND created_at > clock_timestamp() - interval '1 hour'`, [accountId]);
    return rows[0]!.n < MAX_EMAILS_PER_HOUR;
  }

  async function issueToken(q: Queryable, accountId: string, purpose: 'verify_email' | 'reset_password'): Promise<string> {
    const token = newToken();
    const lifetime = purpose === 'verify_email' ? `${VERIFY_HOURS} hours` : `${RESET_MINUTES} minutes`;
    // A new link replaces older ones of the same kind.
    await q.query(`UPDATE customer_tokens SET used_at = clock_timestamp() WHERE account_id = $1 AND purpose = $2 AND used_at IS NULL`, [accountId, purpose]);
    await q.query(
      `INSERT INTO customer_tokens (account_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, clock_timestamp() + $4::interval)`,
      [accountId, purpose, hashToken(token), lifetime]);
    return token;
  }

  const findActive = async (q: Queryable, email: string): Promise<AccountRow | undefined> =>
    (await q.query<AccountRow>(
      'SELECT * FROM customer_accounts WHERE branch_id = $1 AND email = $2 AND deleted_at IS NULL', [await branch(), email])).rows[0];

  async function createSession(q: Queryable, accountId: string, userAgent?: string): Promise<string> {
    const token = newToken();
    await q.query(
      `INSERT INTO customer_sessions (account_id, token_hash, user_agent, expires_at) VALUES ($1, $2, $3, clock_timestamp() + make_interval(days => $4))`,
      [accountId, hashToken(token), userAgent?.slice(0, 300) ?? null, SESSION_DAYS]);
    return token;
  }

  // ---- sign-up and verification ----------------------------------------------------------------------------------
  /** Always answers the same way. An existing account gets a "you already have one" email instead of a second account. */
  async function signup(input: z.output<typeof customerSignupInput>): Promise<void> {
    const existing = await findActive(pool, input.email);
    if (existing) {
      if (await mayEmail(pool, existing.id)) {
        const token = await issueToken(pool, existing.id, 'reset_password');
        await send(existing, 'alreadyRegistered', `${base}/${existing.locale}/account/reset?token=${token}`);
      }
      return;
    }
    const hash = await hashPassword(input.password);
    const account = await withTransaction(pool, async (client) => {
      const { rows } = await client.query<AccountRow>(
        `INSERT INTO customer_accounts (branch_id, email, password_hash, full_name, phone_e164, locale) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [await branch(), input.email, hash, input.full_name, input.phone_e164 ?? null, input.locale]);
      return rows[0]!;
    }).catch(async (err) => {
      // Two sign-ups racing with the same email: the second behaves like "already registered".
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    });
    if (!account) return;
    const token = await issueToken(pool, account.id, 'verify_email');
    await send(account, 'verify', `${base}/${account.locale}/account/verify?token=${token}`);
  }

  async function resendVerification(email: string): Promise<void> {
    const account = await findActive(pool, email);
    if (!account || account.email_verified_at || !(await mayEmail(pool, account.id))) return;
    const token = await issueToken(pool, account.id, 'verify_email');
    await send(account, 'verify', `${base}/${account.locale}/account/verify?token=${token}`);
  }

  /** A one-time link: returns the account it belonged to, or throws. */
  async function consumeToken(q: Queryable, token: string, purpose: 'verify_email' | 'reset_password'): Promise<AccountRow> {
    const { rows } = await q.query<{ account_id: string }>(
      `UPDATE customer_tokens SET used_at = clock_timestamp()
        WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > clock_timestamp()
        RETURNING account_id`, [hashToken(token), purpose]);
    if (!rows[0]) throw new HttpError(400, 'invalid_token', 'This link is invalid, already used or expired');
    const account = (await q.query<AccountRow>('SELECT * FROM customer_accounts WHERE id = $1 AND deleted_at IS NULL AND is_active FOR UPDATE', [rows[0].account_id])).rows[0];
    if (!account) throw new HttpError(400, 'invalid_token', 'This link is invalid, already used or expired');
    return account;
  }

  /**
   * Confirms the email and links the account to the shop's record of this customer: the one the counter created with
   * the same email if there is one (now that ownership of the email is proven), otherwise a new one. Signs the person in.
   */
  async function verifyEmail(token: string, userAgent?: string): Promise<string> {
    return withTransaction(pool, async (client) => {
      const account = await consumeToken(client, token, 'verify_email');
      let customerId = account.customer_id;
      if (!customerId) {
        const known = await client.query<{ id: string }>(
          `SELECT c.id FROM customers c
            WHERE c.branch_id = $1 AND lower(c.email) = $2 AND c.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM customer_accounts a WHERE a.customer_id = c.id AND a.deleted_at IS NULL)
            ORDER BY c.updated_at DESC LIMIT 1`, [account.branch_id, account.email]);
        customerId = known.rows[0]?.id ?? (await client.query<{ id: string }>(
          // The phone typed at sign-up is NOT verified, so it never links this account to a counter customer (that
          // would hand their order history to anyone who types their number). If another customer already has that
          // phone, the new record is created without it; the owner can merge the two from the staff app.
          `INSERT INTO customers (branch_id, full_name, email, phone_e164, locale, email_opt_in, preferred_channel, consent_source, consent_recorded_at)
           VALUES ($1, $2, $3,
                   CASE WHEN EXISTS (SELECT 1 FROM customers WHERE branch_id = $1 AND phone_e164 = $4 AND deleted_at IS NULL) THEN NULL ELSE $4 END,
                   $5, true, 'email', 'checkout', clock_timestamp()) RETURNING id`,
          [account.branch_id, account.full_name, account.email, account.phone_e164, account.locale])).rows[0]!.id;
      }
      await client.query('UPDATE customer_accounts SET email_verified_at = coalesce(email_verified_at, clock_timestamp()), customer_id = $2 WHERE id = $1', [account.id, customerId]);
      return createSession(client, account.id, userAgent);
    });
  }

  // ---- sign-in ---------------------------------------------------------------------------------------------------
  async function login(email: string, password: string, userAgent?: string): Promise<string> {
    const key = `customer:${email}`;
    const locked = await pool.query('SELECT 1 FROM login_failures WHERE identifier = $1 AND locked_until > clock_timestamp()', [key]);
    if (locked.rowCount) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Try again later.');

    const account = await findActive(pool, email);
    const ok = await verifyPassword(account?.password_hash, password);   // runs even for an unknown email
    if (!account || !ok || !account.is_active) {
      await pool.query(
        `INSERT INTO login_failures (identifier, failed_count) VALUES ($1, 1)
         ON CONFLICT (identifier) DO UPDATE SET failed_count = login_failures.failed_count + 1,
           locked_until = CASE WHEN login_failures.failed_count + 1 >= $2 THEN clock_timestamp() + make_interval(mins => $3) ELSE login_failures.locked_until END,
           updated_at = clock_timestamp()`, [key, MAX_FAILED_LOGINS, LOCK_MINUTES]);
      throw new HttpError(401, 'invalid_credentials', 'Wrong email or password');
    }
    await pool.query('DELETE FROM login_failures WHERE identifier = $1', [key]);
    return createSession(pool, account.id, userAgent);
  }

  async function logout(token: string | undefined): Promise<void> {
    if (token) await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  /** The account behind a session cookie, or null. */
  async function accountFor(token: string | undefined): Promise<AccountRow | null> {
    if (!token) return null;
    const { rows } = await pool.query<AccountRow>(
      `SELECT a.* FROM customer_sessions s JOIN customer_accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND a.deleted_at IS NULL AND a.is_active`, [hashToken(token)]);
    return rows[0] ?? null;
  }

  // ---- forgotten password ------------------------------------------------------------------------------------------
  async function forgotPassword(email: string): Promise<void> {
    const account = await findActive(pool, email);
    if (!account || !account.is_active || !(await mayEmail(pool, account.id))) return;
    const token = await issueToken(pool, account.id, 'reset_password');
    await send(account, 'reset', `${base}/${account.locale}/account/reset?token=${token}`);
  }

  /** Sets the new password, signs out every other session (the old password may be what leaked), and signs in here. */
  async function resetPassword(token: string, password: string, userAgent?: string): Promise<string> {
    const hash = await hashPassword(password);
    return withTransaction(pool, async (client) => {
      const account = await consumeToken(client, token, 'reset_password');
      await client.query('UPDATE customer_accounts SET password_hash = $2 WHERE id = $1', [account.id, hash]);
      await client.query('DELETE FROM customer_sessions WHERE account_id = $1', [account.id]);
      // Opening the link proves the email too.
      if (!account.email_verified_at) await client.query('UPDATE customer_accounts SET email_verified_at = clock_timestamp() WHERE id = $1', [account.id]);
      return createSession(client, account.id, userAgent);
    });
  }

  // ---- what a signed-in customer sees ------------------------------------------------------------------------------
  const me = (a: AccountRow): CustomerMe => ({ email: a.email, fullName: a.full_name, phone: a.phone_e164, locale: a.locale, verified: Boolean(a.email_verified_at) });

  async function myOrders(a: AccountRow): Promise<CustomerOrderSummary[]> {
    if (!a.customer_id) return [];
    const { rows } = await pool.query<CustomerOrderSummary>(
      `SELECT public_code AS code, order_number::text AS number, status, total::text AS total, currency,
              payment_status AS "paymentStatus", placed_at AS "placedAt"
         FROM orders WHERE customer_id = $1 AND branch_id = $2 AND deleted_at IS NULL ORDER BY placed_at DESC LIMIT 100`,
      [a.customer_id, a.branch_id]);
    return rows;
  }

  /**
   * The catalogue lines of one of this account's own past orders, each re-checked against the catalogue as it
   * stands right now. A custom, one-off line (no product behind it) cannot be reordered from a picture alone, so
   * those are left out entirely rather than shown as a line nobody can act on.
   */
  async function reorderItems(a: AccountRow, code: string): Promise<ReorderItem[]> {
    if (!a.customer_id) return [];
    const { rows } = await pool.query<ReorderItem>(
      `SELECT oi.product_id AS "productId", oi.name_snapshot AS name, oi.quantity::text AS quantity,
              (p.id IS NOT NULL AND p.is_active AND p.is_public) AS available
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id AND oi.branch_id = o.branch_id AND oi.deleted_at IS NULL
         LEFT JOIN products p ON p.id = oi.product_id AND p.branch_id = o.branch_id AND p.deleted_at IS NULL
        WHERE o.public_code = $1 AND o.customer_id = $2 AND o.branch_id = $3 AND o.deleted_at IS NULL AND oi.product_id IS NOT NULL
        ORDER BY oi.sort_order`,
      [code, a.customer_id, a.branch_id]);
    return rows;
  }

  async function pruneExpired(): Promise<void> {
    await pool.query('DELETE FROM customer_sessions WHERE expires_at < clock_timestamp()');
    await pool.query(`DELETE FROM customer_tokens WHERE expires_at < clock_timestamp() - interval '7 days'`);
  }

  return { signup, resendVerification, verifyEmail, login, logout, accountFor, forgotPassword, resetPassword, me, myOrders, reorderItems, pruneExpired };
}

export type { AccountRow as CustomerAccountRow, CustomerSignupInput };
