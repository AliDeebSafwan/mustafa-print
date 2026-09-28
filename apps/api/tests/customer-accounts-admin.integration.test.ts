import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SITE = 'https://print.example.com';
const A = '/api/v1/admin/customer-accounts';

describe.skipIf(!hasTestDatabase)('the owner manages website accounts', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient, otherAdmin: ApiClient;
  beforeAll(async () => { s = await startTestServer(); admin = await s.as('admin'); staff = await s.as('staff'); otherAdmin = await s.as('otheradmin'); });
  afterAll(async () => { await s.close(); });

  let visitors = 0;
  const browser = () => {
    const ip = `198.51.100.${++visitors}`;
    let cookie = '';
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, {
        method, headers: { 'Content-Type': 'application/json', Origin: SITE, 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='));
      if (set) cookie = set.split(';')[0]!;
      return res;
    };
    return { post: (p: string, b: unknown = {}) => call('POST', p, b), get: (p: string) => call('GET', p) };
  };
  /** Signs up and confirms the email; returns the browser (signed in) and the account id. */
  const webAccount = async (email: string, over: Json = {}) => {
    const b = browser();
    await b.post('/signup', { email, password: 'a good long password', full_name: 'Walid Haddad', locale: 'ar', ...over });
    await b.post('/verify', { token: new URL(s.linkFor(email)).searchParams.get('token') });
    const { rows } = await s.pool.query<{ id: string; customer_id: string }>('SELECT id, customer_id FROM customer_accounts WHERE email = $1', [email]);
    return { b, id: rows[0]!.id, customerId: rows[0]!.customer_id };
  };
  const post = (client: ApiClient, path: string, body: unknown = {}) => client.post(`${A}${path}`, body);

  it('is for the owner only', async () => {
    expect((await staff.get(A)).status).toBe(403);
    expect((await admin.get(A)).status).toBe(200);
  });

  it('lists and searches accounts, with each one\'s order count', async () => {
    const { customerId } = await webAccount('listed@example.com', { full_name: 'Nadine Listed' });
    await createOrder(staff, customerId);
    const found = await jsonOf<Json[]>(await admin.get(`${A}?q=nadine`));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ email: 'listed@example.com', is_active: true, order_count: 1 });
    expect(await jsonOf<Json[]>(await otherAdmin.get(`${A}?q=nadine`))).toEqual([]);   // another branch never sees it
  });

  describe('disabling an abusive account', () => {
    it('signs it out at once, refuses sign-in, and can be undone — all in the audit log', async () => {
      const { b, id } = await webAccount('abusive@example.com');
      expect((await b.get('/me')).status).toBe(200);

      expect((await post(admin, `/${id}/deactivate`)).status).toBe(200);
      expect((await b.get('/me')).status).toBe(401);
      expect((await browser().post('/login', { email: 'abusive@example.com', password: 'a good long password' })).status).toBe(401);

      expect((await post(admin, `/${id}/reactivate`)).status).toBe(200);
      expect((await browser().post('/login', { email: 'abusive@example.com', password: 'a good long password' })).status).toBe(200);

      const log = await jsonOf<Json[]>(await admin.get('/api/v1/admin/team/audit-log'));
      expect(log.filter((e) => e.target_id === id).map((e) => e.action)).toEqual(['customer_account.reactivated', 'customer_account.deactivated']);
    });
  });

  describe('merging a duplicate into the counter customer', () => {
    it('suggests the counter customer with the same phone, and merging puts the whole history in one place', async () => {
      // At the counter, by phone only, with one order.
      const counterId = await createCustomer(staff, { full_name: 'Walid Haddad', phone_e164: '+96171222333' } as never);
      const counterOrder = await createOrder(staff, counterId);
      // Then online, same person, same phone, and one more order.
      const { b, id, customerId: webId } = await webAccount('walid@example.com', { phone_e164: '+96171222333' });
      const webOrder = await createOrder(staff, webId);
      expect((await jsonOf<Json[]>(await b.get('/orders'))).map((o) => o.code)).toEqual([webOrder.code]);   // not yet linked

      const detail = await jsonOf<Json>(await admin.get(`${A}/${id}`));
      expect(detail.candidates.map((c: Json) => c.id)).toContain(counterId);

      const merged = await jsonOf<Json>(await post(admin, `/${id}/merge`, { customer_id: counterId }));
      expect(merged).toMatchObject({ customer_id: counterId, orders_moved: 1 });

      // The website now shows both orders; the duplicate is retired; the counter record gained the verified email.
      expect((await jsonOf<Json[]>(await b.get('/orders'))).map((o) => o.code).sort()).toEqual([counterOrder.code, webOrder.code].sort());
      const { rows: [dup] } = await s.pool.query('SELECT deleted_at FROM customers WHERE id = $1', [webId]);
      expect(dup.deleted_at).not.toBeNull();
      const { rows: [kept] } = await s.pool.query('SELECT email, email_opt_in FROM customers WHERE id = $1', [counterId]);
      expect(kept).toEqual({ email: 'walid@example.com', email_opt_in: true });

      const log = await jsonOf<Json[]>(await admin.get('/api/v1/admin/team/audit-log'));
      expect(log.find((e) => e.action === 'customer_account.merged' && e.target_id === id)).toMatchObject({ details: { from_customer: webId, to_customer: counterId, orders_moved: 1 } });
    });

    it('refuses what would be wrong: an unconfirmed account, the same record, one already tied to another account, another branch', async () => {
      const unverified = browser();
      await unverified.post('/signup', { email: 'pending@example.com', password: 'a good long password', full_name: 'Pending', locale: 'ar' });
      const { rows: [pending] } = await s.pool.query<{ id: string }>(`SELECT id FROM customer_accounts WHERE email = 'pending@example.com'`);
      const someone = await createCustomer(staff);
      expect(await jsonOf(await post(admin, `/${pending!.id}/merge`, { customer_id: someone }))).toMatchObject({ message: 'not_verified' });

      const { id, customerId } = await webAccount('solo@example.com');
      expect(await jsonOf(await post(admin, `/${id}/merge`, { customer_id: customerId }))).toMatchObject({ message: 'same_customer' });

      const other = await webAccount('other@example.com');
      expect(await jsonOf(await post(admin, `/${id}/merge`, { customer_id: other.customerId }))).toMatchObject({ message: 'target_has_account' });

      const foreign = await createCustomer(otherAdmin);
      expect((await post(admin, `/${id}/merge`, { customer_id: foreign })).status).toBe(404);
    });
  });
});
