import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SITE = 'https://print.example.com';

describe.skipIf(!hasTestDatabase)('customer accounts on the website', () => {
  let s: TestServer;
  let reception: ApiClient, admin: ApiClient;
  beforeAll(async () => { s = await startTestServer(); reception = await s.as('receptionist'); admin = await s.as('admin'); });
  afterAll(async () => { await s.close(); });

  /** A browser on the website: its own visitor address, its session cookie, and the site's Origin. */
  let visitors = 0;
  const browser = (ip = `203.0.113.${++visitors}`) => {
    let cookie = '';
    const call = async (method: string, path: string, body?: unknown, origin = SITE) => {
      const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, {
        method, headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='));
      if (set) cookie = set.split(';')[0]!.endsWith('=') ? '' : set.split(';')[0]!;
      return res;
    };
    return { post: (p: string, b?: unknown, origin?: string) => call('POST', p, b ?? {}, origin), get: (p: string) => call('GET', p), cookie: () => cookie };
  };
  const tokenFrom = (link: string) => new URL(link).searchParams.get('token')!;
  const signup = (b: ReturnType<typeof browser>, email: string, over: Json = {}) =>
    b.post('/signup', { email, password: 'a good long password', full_name: 'Layla Nasser', locale: 'en', ...over });

  it('signs up, confirms the email from the link, and is signed in', async () => {
    const b = browser();
    const res = await signup(b, 'Layla@Example.com ');
    expect(res.status).toBe(202);
    expect(await jsonOf(res)).toEqual({ status: 'check_email' });

    const link = s.linkFor('layla@example.com');                             // stored lower-cased
    expect(link.startsWith(`${SITE}/en/account/verify?token=`)).toBe(true);
    expect(s.emails.at(-1)).toMatchObject({ subject: 'Confirm your email', locale: 'en' });

    const verified = await b.post('/verify', { token: tokenFrom(link) });
    expect(verified.status).toBe(200);
    expect(await jsonOf(verified)).toEqual({ email: 'layla@example.com', fullName: 'Layla Nasser', phone: null, locale: 'en', verified: true });
    expect(await jsonOf(await b.get('/me'))).toMatchObject({ verified: true });

    const setCookie = verified.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/public\/account/i);
  });

  it('never tells a stranger whether an email has an account', async () => {
    await signup(browser(), 'known@example.com');
    const before = s.emails.length;
    const again = await signup(browser(), 'known@example.com', { password: 'another long password', full_name: 'Impostor' });
    expect(again.status).toBe(202);
    expect(await jsonOf(again)).toEqual({ status: 'check_email' });
    expect(s.emails.length).toBe(before + 1);
    expect(s.emails.at(-1)).toMatchObject({ to: 'known@example.com', subject: 'You already have an account' });   // the owner is warned, the impostor learns nothing
    expect((await s.pool.query(`SELECT count(*)::int AS n FROM customer_accounts WHERE email = 'known@example.com'`)).rows[0].n).toBe(1);

    for (const email of ['known@example.com', 'nobody@example.com']) {
      expect(await jsonOf(await browser().post('/password/forgot', { email }))).toEqual({ status: 'check_email' });
    }
    const wrong = await browser().post('/login', { email: 'known@example.com', password: 'not the password' });
    const unknown = await browser().post('/login', { email: 'nobody@example.com', password: 'not the password' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await jsonOf(wrong)).toEqual(await jsonOf(unknown));
  });

  it('links a verified account to the customer the counter already had, with their past orders', async () => {
    const customerId = await createCustomer(reception, { full_name: 'Omar Khoury', email: 'omar@example.com', phone_e164: '+96171222333' });
    const past = await createOrder(reception, customerId);

    const b = browser();
    await signup(b, 'omar@example.com', { full_name: 'Omar K.' });
    await b.post('/verify', { token: tokenFrom(s.linkFor('omar@example.com')) });
    const orders = await jsonOf<Json[]>(await b.get('/orders'));
    expect(orders.map((o) => o.code)).toEqual([past.code]);
    expect(orders[0]).toMatchObject({ status: 'received', currency: 'USD' });
    const [account] = (await s.pool.query('SELECT customer_id FROM customer_accounts WHERE email = $1', ['omar@example.com'])).rows;
    expect(account.customer_id).toBe(customerId);
  });

  it('an unverified account sees no orders, even for a counter customer with the same email', async () => {
    const customerId = await createCustomer(reception, { full_name: 'Sara', email: 'sara@example.com', phone_e164: '+96171444555' });
    await createOrder(reception, customerId);
    const impostor = browser();
    await signup(impostor, 'sara@example.com', { password: 'impostor long password' });
    await impostor.post('/login', { email: 'sara@example.com', password: 'impostor long password' });
    expect(await jsonOf(await impostor.get('/me'))).toMatchObject({ verified: false });
    expect(await jsonOf(await impostor.get('/orders'))).toEqual([]);
  });

  it('a verification or reset link works once, and not after it expires', async () => {
    const b = browser();
    await signup(b, 'once@example.com');
    const token = tokenFrom(s.linkFor('once@example.com'));
    expect((await b.post('/verify', { token })).status).toBe(200);
    const reused = await browser().post('/verify', { token });
    expect(reused.status).toBe(400);
    expect(await jsonOf(reused)).toMatchObject({ error: 'invalid_token' });

    await browser().post('/password/forgot', { email: 'once@example.com' });
    const reset = tokenFrom(s.linkFor('once@example.com'));
    await s.pool.query(`UPDATE customer_tokens SET expires_at = clock_timestamp() - interval '1 second' WHERE purpose = 'reset_password'`);
    expect((await browser().post('/password/reset', { token: reset, password: 'brand new password' })).status).toBe(400);
  });

  it('a new password signs out every other session and signs in here', async () => {
    const laptop = browser();
    await signup(laptop, 'reset@example.com');
    await laptop.post('/verify', { token: tokenFrom(s.linkFor('reset@example.com')) });
    expect((await laptop.get('/me')).status).toBe(200);

    const phone = browser();
    await phone.post('/password/forgot', { email: 'reset@example.com' });
    const res = await phone.post('/password/reset', { token: tokenFrom(s.linkFor('reset@example.com')), password: 'brand new password' });
    expect(res.status).toBe(200);
    expect((await phone.get('/me')).status).toBe(200);
    expect((await laptop.get('/me')).status).toBe(401);                       // the old session is gone
    expect((await browser().post('/login', { email: 'reset@example.com', password: 'a good long password' })).status).toBe(401);
    expect((await browser().post('/login', { email: 'reset@example.com', password: 'brand new password' })).status).toBe(200);
  });

  it('refuses short passwords, requests from other sites, and locks out password guessing', async () => {
    const short = await signup(browser(), 'short@example.com', { password: 'short' });
    expect(short.status).toBe(400);
    const foreign = await browser().post('/login', { email: 'x@example.com', password: 'whatever' }, 'https://evil.example');
    expect(foreign.status).toBe(403);

    await signup(browser(), 'target@example.com');
    for (let i = 0; i < 5; i++) await browser().post('/login', { email: 'target@example.com', password: 'guess guess ' + i });
    const locked = await browser().post('/login', { email: 'target@example.com', password: 'a good long password' });
    expect(locked.status).toBe(429);
  });

  it('signing out ends the session', async () => {
    const b = browser();
    await signup(b, 'bye@example.com');
    await b.post('/verify', { token: tokenFrom(s.linkFor('bye@example.com')) });
    expect((await b.post('/logout')).status).toBe(204);
    expect((await b.get('/me')).status).toBe(401);
  });

  it('caps the emails one address can be sent, so the form cannot flood an inbox', async () => {
    await signup(browser(), 'flood@example.com');
    for (let i = 0; i < 6; i++) await browser().post('/password/forgot', { email: 'flood@example.com' });
    expect(s.emails.filter((e) => e.to === 'flood@example.com').length).toBe(3);
  });

  it('slows down one visitor hammering the sign-in form', async () => {
    const attacker = browser('198.51.100.7');
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await attacker.post('/login', { email: `guess${i}@example.com`, password: 'guess guess guess' })).status);
    expect(statuses.slice(0, 20).every((code) => code === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
    expect((await browser().post('/login', { email: 'someone@example.com', password: 'whatever long' })).status).toBe(401);   // others are unaffected
  });

  it('a counter customer who signs up with the same phone can still confirm, and is NOT linked by that unverified phone', async () => {
    // Registered at the counter by phone only. Then someone signs up on the website typing that phone.
    const { createCustomer } = await import('./helpers/sync-client');
    const counterId = await createCustomer(reception, { full_name: 'Counter Walid', phone_e164: '+96170555111' } as never);
    const b = browser();
    await signup(b, 'walid@example.com', { full_name: 'Walid Online', phone_e164: '+96170555111' });
    const verified = await b.post('/verify', { token: tokenFrom(s.linkFor('walid@example.com')) });
    expect(verified.status).toBe(200);

    // The website account got its own customer record: a typed phone proves nothing, so it must never unlock the
    // counter customer's order history. Merging the two is the owner's decision, from the staff app.
    const { rows } = await s.pool.query(`SELECT customer_id FROM customer_accounts WHERE email = 'walid@example.com'`);
    expect(rows[0].customer_id).not.toBe(counterId);
    const web = await s.pool.query(`SELECT phone_e164 FROM customers WHERE id = $1`, [rows[0].customer_id]);
    expect(web.rows[0].phone_e164).toBeNull();   // the phone stays with the counter record it already belongs to
  });

  describe('ordering the same thing again', () => {
    const product = async (name = 'Flyers A5') => {
      const id = newId();
      const r = await pushOne(admin, mutation('products:insert', id, { sku: `RO-${id}`, name_ar: name, name_en: name, base_price: '5', is_active: true, is_public: true } as never));
      if (r.result !== 'applied') throw new Error('product insert failed: ' + JSON.stringify(r));
      return id;
    };
    const setProduct = (id: string, patch: Record<string, unknown>) =>
      s.pool.query(`UPDATE products SET ${Object.keys(patch).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...Object.values(patch)]);

    it('lists only the lines that came from a real product, and never a hand-typed one-off line', async () => {
      const productId = await product();
      const customerId = await createCustomer(reception, { full_name: 'Rima', email: 'rima@example.com' } as never);
      const order = await createOrder(reception, customerId, {
        items: [
          { id: newId(), product_id: productId, name_snapshot: 'Flyers A5', quantity: '500', unit_price: '5' },
          { id: newId(), name_snapshot: 'Custom banner, hand-written', quantity: '1', unit_price: '30' },
        ],
      } as never);

      const b = browser();
      await signup(b, 'rima@example.com');
      await b.post('/verify', { token: tokenFrom(s.linkFor('rima@example.com')) });
      const items = await jsonOf<Json[]>(await b.get(`/orders/${order.code}/reorder`));
      expect(items).toEqual([{ productId, name: 'Flyers A5', quantity: '500.000', available: true }]);
    });

    it('marks a line unavailable once its product is deactivated or unpublished, without dropping it', async () => {
      const productId = await product();
      const customerId = await createCustomer(reception, { full_name: 'Nabil', email: 'nabil@example.com' } as never);
      const order = await createOrder(reception, customerId, { items: [{ id: newId(), product_id: productId, name_snapshot: 'Flyers A5', quantity: '10', unit_price: '5' }] } as never);
      const b = browser();
      await signup(b, 'nabil@example.com');
      await b.post('/verify', { token: tokenFrom(s.linkFor('nabil@example.com')) });

      expect((await jsonOf<Json[]>(await b.get(`/orders/${order.code}/reorder`)))[0]).toMatchObject({ available: true });
      await setProduct(productId, { is_active: false });
      expect((await jsonOf<Json[]>(await b.get(`/orders/${order.code}/reorder`)))[0]).toMatchObject({ available: false });
      await setProduct(productId, { is_active: true, is_public: false });
      expect((await jsonOf<Json[]>(await b.get(`/orders/${order.code}/reorder`)))[0]).toMatchObject({ available: false });
    });

    it('never returns another customer\'s order, and answers a made-up or malformed code the same way', async () => {
      const productId = await product();
      await createCustomer(reception, { full_name: 'Owner', email: 'owner-reorder@example.com' } as never);
      const theirsId = await createCustomer(reception, { full_name: 'Other', email: 'other-reorder@example.com' } as never);
      const theirs = await createOrder(reception, theirsId, { items: [{ id: newId(), product_id: productId, name_snapshot: 'x', quantity: '1', unit_price: '5' }] } as never);

      const b = browser();
      await signup(b, 'owner-reorder@example.com');
      await b.post('/verify', { token: tokenFrom(s.linkFor('owner-reorder@example.com')) });
      expect(await jsonOf(await b.get(`/orders/${theirs.code}/reorder`))).toEqual([]);
      expect(await jsonOf(await b.get('/orders/ZZZZZZZZZZ/reorder'))).toEqual([]);   // right shape, no such order
      expect((await b.get('/orders/not-a-real-code/reorder')).status).toBe(404);      // wrong shape entirely
    });

    it('is empty for a signed-in but unverified account, same as the order list itself', async () => {
      const productId = await product();
      const customerId = await createCustomer(reception, { full_name: 'Yara', email: 'yara-reorder@example.com' } as never);
      const order = await createOrder(reception, customerId, { items: [{ id: newId(), product_id: productId, name_snapshot: 'x', quantity: '1', unit_price: '5' }] } as never);
      const impostor = browser();
      await signup(impostor, 'yara-reorder@example.com', { password: 'impostor long password' });
      await impostor.post('/login', { email: 'yara-reorder@example.com', password: 'impostor long password' });
      expect(await jsonOf(await impostor.get(`/orders/${order.code}/reorder`))).toEqual([]);
    });
  });
});
