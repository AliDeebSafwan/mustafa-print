import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type Agent } from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent as HttpsAgent } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { hasTestDatabase } from './helpers/test-db';
import { createTestDatabase } from './helpers/test-db';
import { jsonOf, seedFixtures, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const VAPID = webpush.generateVAPIDKeys();
const SITE = 'https://print.example.com';

/** web-push always speaks TLS to the endpoint it is given, whatever scheme the URL declares — real push services are
 *  always https — so the local stand-in server here must be https too, with a throwaway self-signed cert, and every
 *  send in these tests uses an agent that accepts it (a real deployment always talks to a properly certified push
 *  service; this is purely to exercise the code path locally without reaching the internet). */
function selfSignedCert() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mpe-push-cert-'));
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-keyout', key, '-out', cert,
    '-days', '1', '-nodes', '-subj', '/CN=localhost']);
  return { key: readFileSync(key), cert: readFileSync(cert) };
}
const insecureAgent: Agent = new HttpsAgent({ rejectUnauthorized: false });

function fakePushEndpoint() {
  let count = 0;
  let nextStatus = 201;
  const { key, cert } = selfSignedCert();
  const server = createServer({ key, cert }, (_req, res) => { count++; res.writeHead(nextStatus).end(); });
  return {
    urlFor: () => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`https://127.0.0.1:${(server.address() as AddressInfo).port}/push`))),
    count: () => count, setNextStatus: (s: number) => { nextStatus = s; }, close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
/** A real ECDH P-256 keypair and a proper 16-byte auth secret — what a browser's real subscription provides, and
 *  the shape web-push actually needs to encrypt a payload before it ever gets to the network. */
const fakeKeys = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') };
};

describe.skipIf(!hasTestDatabase)('Web Push for staff', () => {
  describe('when no VAPID keys are configured (the default)', () => {
    let s: TestServer, staff: ApiClient;
    beforeAll(async () => { s = await startTestServer(); staff = await s.as('staff'); });
    afterAll(async () => { await s.close(); });

    it('says so plainly, and never accepts a subscription', async () => {
      expect(await jsonOf<Json>(await staff.get('/api/v1/admin/push/vapid-public-key'))).toEqual({ publicKey: null });
      const res = await staff.post('/api/v1/admin/push/subscribe', { endpoint: 'https://push.example/x', keys: fakeKeys() });
      expect(res.status).toBe(409);
      expect(await jsonOf<Json>(res)).toMatchObject({ message: 'push_not_configured' });
    });
  });

  describe('once VAPID keys are configured', () => {
    let s: TestServer, staff: ApiClient, otherStaff: ApiClient;
    beforeAll(async () => {
      s = await startTestServer({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'mailto:owner@example.com' });
      staff = await s.as('staff'); otherStaff = await s.as('staff');
    });
    afterAll(async () => { await s.close(); });

    it('publishes its public key, and lets staff subscribe and unsubscribe their own browser', async () => {
      expect(await jsonOf<Json>(await staff.get('/api/v1/admin/push/vapid-public-key'))).toEqual({ publicKey: VAPID.publicKey });
      const endpoint = 'https://fcm.googleapis.com/fcm/send/subscribe-test';
      expect((await staff.post('/api/v1/admin/push/subscribe', { endpoint, keys: fakeKeys() })).status).toBe(204);
      expect((await s.pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rowCount).toBe(1);
      expect((await staff.post('/api/v1/admin/push/unsubscribe', { endpoint })).status).toBe(204);
      expect((await s.pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rowCount).toBe(0);
    });

    it('refuses any endpoint that is not a real browser push service: the server must never be made to call inside the network', async () => {
      for (const endpoint of ['https://127.0.0.1:5432/x', 'https://169.254.169.254/latest/meta-data', 'https://db:5432/x', 'http://fcm.googleapis.com/x',
        'https://fcm.googleapis.com:8443/x', 'https://evil-fcm.googleapis.com.attacker.example/x', 'https://user:pw@fcm.googleapis.com/x']) {
        const res = await staff.post('/api/v1/admin/push/subscribe', { endpoint, keys: fakeKeys() });
        expect(await jsonOf<Json>(res), endpoint).toMatchObject({ message: 'not_a_push_service' });
      }
      expect((await s.pool.query(`SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint NOT LIKE 'https://fcm.%' AND endpoint NOT LIKE 'https://updates.%'`)).rows[0].n).toBe(0);
    });

    it('subscribing the same endpoint again just refreshes it, rather than erroring', async () => {
      const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/re-subscribe';
      await staff.post('/api/v1/admin/push/subscribe', { endpoint, keys: fakeKeys() });
      expect((await otherStaff.post('/api/v1/admin/push/subscribe', { endpoint, keys: fakeKeys() })).status).toBe(204);
      expect((await s.pool.query('SELECT count(*)::int AS n FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rows[0].n).toBe(1);
    });
  });

  describe('sending an alert directly (createPushService)', () => {
    let fake: ReturnType<typeof fakePushEndpoint>;
    afterEach(async () => { await fake?.close(); });

    it('reaches a subscribed browser, and forgets one the push service reports gone', async () => {
      const { createPushService } = await import('../src/modules/push/push.service');
      const db = await createTestDatabase();
      const fixtures = await seedFixtures(db.pool);
      const push = createPushService({ pool: db.pool, publicKey: VAPID.publicKey, privateKey: VAPID.privateKey, subject: 'mailto:owner@example.com', agent: insecureAgent, extraAllowedHosts: ['127.0.0.1'] });

      fake = fakePushEndpoint();
      const endpoint = await fake.urlFor();
      await db.pool.query(`INSERT INTO push_subscriptions (branch_id, user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4,$5)`,
        [fixtures.branchId, fixtures.users.admin.id, endpoint, ...Object.values(fakeKeys())]);

      await push.notifyBranch(fixtures.branchId, { title: 'x', body: 'y', url: '/orders/1' });
      expect(fake.count()).toBe(1);
      expect((await db.pool.query('SELECT last_error FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rows[0].last_error).toBeNull();

      fake.setNextStatus(410);
      await push.notifyBranch(fixtures.branchId, { title: 'x', body: 'y', url: '/orders/1' });
      expect(fake.count()).toBe(2);
      expect((await db.pool.query('SELECT last_error FROM push_subscriptions WHERE endpoint = $1', [endpoint])).rows[0].last_error).toBe('gone (410)');

      await push.notifyBranch(fixtures.branchId, { title: 'x', body: 'y', url: '/orders/1' });
      expect(fake.count()).toBe(2);   // marked gone: never tried again
      await db.drop();
    });
  });

  describe('a new web order', () => {
    let s: TestServer, fake: ReturnType<typeof fakePushEndpoint>;
    beforeAll(async () => {
      s = await startTestServer({ VAPID_PUBLIC_KEY: VAPID.publicKey, VAPID_PRIVATE_KEY: VAPID.privateKey, VAPID_SUBJECT: 'mailto:owner@example.com' }, { pushAgent: insecureAgent, pushAllowedHosts: ['127.0.0.1'] });
      fake = fakePushEndpoint();
    });
    afterAll(async () => { await s.close(); await fake.close(); });

    const browser = () => {
      let cookie = '';
      const call = async (path: string, body: unknown) => {
        const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
        });
        const set = res.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='));
        if (set) cookie = set.split(';')[0]!;
        return res;
      };
      return { post: call };
    };

    it('alerts a subscribed staff member, exactly once even if the same checkout is resubmitted', async () => {
      const staff = await s.as('staff');
      const endpoint = await fake.urlFor();
      await staff.post('/api/v1/admin/push/subscribe', { endpoint, keys: fakeKeys() });

      const { rows: [product] } = await s.pool.query<{ id: string }>(
        `INSERT INTO products (branch_id, sku, name_ar, name_en, base_price, is_public)
         VALUES ((SELECT branch_id FROM users WHERE email = 'staff@test.example'), 'PUSH-1', 'x', 'x', '5', true) RETURNING id`);

      const b = browser();
      const email = `push-order-${Date.now()}@example.com`;
      await b.post('/signup', { email, password: 'a good long password', full_name: 'Push Test', locale: 'en' });
      const link = s.linkFor(email);
      await b.post('/verify', { token: new URL(link).searchParams.get('token') });

      const requestId = crypto.randomUUID();
      const order = { request_id: requestId, items: [{ product_id: product!.id, quantity: '1' }], fulfillment_type: 'pickup', payment_method: 'cash' };
      expect((await b.post('/orders', order)).status).toBe(201);
      await new Promise((r) => setTimeout(r, 100));   // the alert fires after the transaction commits, not inside it
      expect(fake.count()).toBe(1);

      expect((await b.post('/orders', order)).status).toBe(201);   // the exact same checkout, resubmitted
      await new Promise((r) => setTimeout(r, 100));
      expect(fake.count()).toBe(1);   // a genuine repeat of an already-placed order never alerts twice
    });
  });
});
