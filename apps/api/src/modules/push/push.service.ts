import type { Agent } from 'node:https';
import type { Pool } from 'pg';
import webpush from 'web-push';
import { HttpError } from '../../http-error';
import type { AuthContext } from '../auth/types';

export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }

export type PushService = ReturnType<typeof createPushService>;

/**
 * The browsers' own push services. The server POSTs to whatever endpoint a subscription names, so an endpoint is
 * accepted only on these hosts (https, default port): otherwise any staff login could make the server send requests
 * into the shop's own network — the database, the cloud metadata address — a server-side request forgery.
 */
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];

export function isPushServiceEndpoint(endpoint: string, extraHosts: readonly string[] = []): boolean {
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (extraHosts.includes(host)) return true;                       // tests only: a local stand-in push service
  if (url.port) return false;
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * The Meta-approval-free alternative to a WhatsApp alert: any staff member with orders:read can turn this on for
 * their own browser, and gets a notification — even with the app closed — the moment a web order comes in.
 * `configured` is false when no VAPID keys were set; every method then does nothing, quietly, since a shop that
 * has not generated keys yet should behave exactly as if this feature did not exist.
 */
export function createPushService({ pool, publicKey, privateKey, subject, agent, extraAllowedHosts = [] }: { pool: Pool; publicKey?: string; privateKey?: string; subject?: string; agent?: Agent; extraAllowedHosts?: readonly string[] }) {
  const configured = Boolean(publicKey && privateKey && subject);
  if (configured) webpush.setVapidDetails(subject!, publicKey!, privateKey!);

  async function subscribe(auth: AuthContext, sub: PushSubscriptionInput): Promise<void> {
    if (!configured) throw new HttpError(409, 'invalid_request', 'push_not_configured');
    if (!isPushServiceEndpoint(sub.endpoint, extraAllowedHosts)) throw new HttpError(400, 'invalid_request', 'not_a_push_service');
    await pool.query(
      `INSERT INTO push_subscriptions (branch_id, user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $4, auth = $5, user_agent = $6, last_error = NULL`,
      [auth.branchId, auth.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, sub.userAgent?.slice(0, 300) ?? null]);
  }

  async function unsubscribe(auth: AuthContext, endpoint: string): Promise<void> {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND branch_id = $2', [endpoint, auth.branchId]);
  }

  /** Every subscription in the branch gets the same alert; one that the push service reports as gone is forgotten,
   *  not retried forever. Never throws: a notification failing is never a reason to fail the order that triggered it. */
  async function notifyBranch(branchId: string, payload: { title: string; body: string; url: string }): Promise<void> {
    if (!configured) return;
    const { rows } = await pool.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE branch_id = $1 AND last_error IS NULL', [branchId]);
    await Promise.all(rows.map(async (row) => {
      if (!isPushServiceEndpoint(row.endpoint, extraAllowedHosts)) return;   // one saved before this check existed: never contacted
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), agent ? { agent } : undefined);
        await pool.query('UPDATE push_subscriptions SET last_sent_at = clock_timestamp() WHERE id = $1', [row.id]);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await pool.query('UPDATE push_subscriptions SET last_error = $2 WHERE id = $1', [row.id, `gone (${status})`]);
        // Any other failure (network blip, push service hiccup) is left alone: it may well succeed next time.
      }
    }));
  }

  return { configured, publicKey, subscribe, unsubscribe, notifyBranch };
}
