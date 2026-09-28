import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../src/modules/auth/tokens';
import { hasTestDatabase } from './helpers/test-db';
import { cookieFrom, jsonOf, ORIGIN, PASSWORD, startTestServer, type TestServer } from './helpers/test-server';

describe.skipIf(!hasTestDatabase)('authentication over HTTP', () => {
  let s: TestServer;
  beforeAll(async () => { s = await startTestServer(); });
  afterAll(async () => { await s.close(); });

  const login = (identifier: string, password = PASSWORD) => s.raw.post('/api/v1/auth/login', { identifier, password });
  const refresh = (cookie: string, origin = ORIGIN) => s.raw.post('/api/v1/auth/refresh', {}, { headers: { Cookie: cookie, Origin: origin } });
  const email = (name: keyof TestServer['fixtures']['users']) => s.fixtures.users[name].email;

  it('logs in and returns a session; the refresh token is only in a locked-down cookie', async () => {
    const res = await login(email('receptionist'));
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body).toMatchObject({ expiresIn: 900, user: { role: 'receptionist', branchId: s.fixtures.branchId } });
    // the branch's rules travel with the session, so a device still knows them after it goes offline
    expect(body.branch).toMatchObject({ id: s.fixtures.branchId, nameAr: 'MAIN', baseCurrency: 'USD', maxDiscountPercent: null });
    expect(body.user.permissions).toContain('orders:create');
    expect(JSON.stringify(body)).not.toContain('refresh');

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('mpe_rt='))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\/api\/v1\/auth/i);

    const me = await (await s.as('receptionist')).get('/api/v1/auth/me');
    expect(await me.json()).toMatchObject({ fullName: 'receptionist', role: 'receptionist' });
  });

  it('carries the shop\'s discount limit once it is set', async () => {
    await s.pool.query(`UPDATE branches SET max_discount_percent = 12.5 WHERE id = $1`, [s.fixtures.branchId]);
    const body = await jsonOf(await login(email('receptionist')));
    expect(body.branch.maxDiscountPercent).toBe(12.5);
    await s.pool.query(`UPDATE branches SET max_discount_percent = NULL WHERE id = $1`, [s.fixtures.branchId]);
  });

  it('accepts a phone number as identifier and never stores the refresh token in clear text', async () => {
    await s.pool.query(`UPDATE users SET phone_e164 = '+96170555001' WHERE email = $1`, [email('operator')]);
    const res = await login('+961 70 555 001');
    expect(res.status).toBe(200);
    const raw = cookieFrom(res)!.split('=')[1]!;
    const { rows } = await s.pool.query('SELECT token_hash FROM refresh_tokens WHERE token_hash = $1', [hashRefreshToken(raw)]);
    expect(rows).toHaveLength(1);
    expect((await s.pool.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1', [raw])).rowCount).toBe(0);
  });

  it('answers wrong password and unknown account identically (no user enumeration)', async () => {
    const wrongPassword = await login(email('admin'), 'nope-nope-nope');
    const unknown = await login('nobody@test.example', 'nope-nope-nope');
    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknown.json());
  });

  it('rejects malformed login bodies with 400', async () => {
    expect((await s.raw.post('/api/v1/auth/login', { identifier: 'x' })).status).toBe(400);
    expect((await s.raw.post('/api/v1/auth/login', { identifier: 'admin@test.example', password: 5 })).status).toBe(400);
  });

  it('refuses inactive accounts even with the right password', async () => {
    await s.pool.query(`UPDATE users SET is_active = false WHERE email = $1`, [email('warehouse')]);
    expect((await login(email('warehouse'))).status).toBe(401);
    await s.pool.query(`UPDATE users SET is_active = true WHERE email = $1`, [email('warehouse')]);
  });

  it('locks an identifier after repeated failures (also for unknown identifiers) and unlocks on success afterwards', async () => {
    // A user made just for this test: reusing a shared fixture identifier risks a lockout meant for this test
    // reaching some other test that happens to log in as the same person around the same time.
    const lockoutEmail = 'lockout-test@test.example';
    await s.pool.query(
      `INSERT INTO users (branch_id, role_id, full_name, email, password_hash)
       SELECT branch_id, role_id, 'Lockout Test', $2, password_hash FROM users WHERE email = $1`,
      [email('warehouse'), lockoutEmail]);
    for (const who of [lockoutEmail, 'ghost@test.example']) {
      for (let i = 0; i < 5; i++) expect((await login(who, 'bad-bad-bad')).status).toBe(401);
      const locked = await login(who, who === 'ghost@test.example' ? 'bad-bad-bad' : PASSWORD);   // even the right password is refused while locked
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    await s.pool.query(`UPDATE login_failures SET locked_until = clock_timestamp() - interval '1 second'`);
    expect((await login(lockoutEmail)).status).toBe(200);
    expect((await s.pool.query('SELECT 1 FROM login_failures WHERE identifier = $1', [lockoutEmail])).rowCount).toBe(0);
  });

  describe('refresh rotation', () => {
    it('rotates the token and keeps the user signed in', async () => {
      const first = cookieFrom(await login(email('admin')))!;
      const res = await refresh(first);
      expect(res.status).toBe(200);
      const second = cookieFrom(res)!;
      expect(second).not.toBe(first);
      const me = await s.raw.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${(await jsonOf(res)).accessToken}` } });
      expect(me.status).toBe(200);
    });

    it('treats an immediate second use of a rotated token as a harmless race, not theft', async () => {
      const first = cookieFrom(await login(email('admin')))!;
      const second = cookieFrom(await refresh(first))!;
      const raced = await refresh(first);
      expect(raced.status).toBe(401);
      expect(await raced.json()).toMatchObject({ error: 'refresh_race' });
      expect((await refresh(second)).status).toBe(200);       // the legitimate holder is unaffected
    });

    it('revokes the whole family when an old token is replayed after the grace window', async () => {
      const first = cookieFrom(await login(email('admin')))!;
      const second = cookieFrom(await refresh(first))!;
      await s.pool.query(`UPDATE refresh_tokens SET revoked_at = clock_timestamp() - interval '1 minute' WHERE token_hash = $1`, [hashRefreshToken(first.split('=')[1]!)]);
      const replay = await refresh(first);
      expect(replay.status).toBe(401);
      expect(await replay.json()).toMatchObject({ error: 'invalid_refresh' });
      expect((await refresh(second)).status).toBe(401);       // the thief AND the victim must sign in again
    });

    it('rejects unknown, missing and expired tokens', async () => {
      expect((await refresh('mpe_rt=unknown-token')).status).toBe(401);
      expect((await s.raw.post('/api/v1/auth/refresh', {}, { headers: { Origin: ORIGIN } })).status).toBe(401);
      const cookie = cookieFrom(await login(email('admin')))!;
      await s.pool.query(`UPDATE refresh_tokens SET expires_at = clock_timestamp() - interval '1 second' WHERE token_hash = $1`, [hashRefreshToken(cookie.split('=')[1]!)]);
      expect((await refresh(cookie)).status).toBe(401);
    });

    it('refuses cross-origin refresh requests', async () => {
      const cookie = cookieFrom(await login(email('admin')))!;
      const res = await refresh(cookie, 'https://evil.example');
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'origin_not_allowed' });
    });
  });

  describe('revocation', () => {
    it('logout kills the session on the server and clears the cookie', async () => {
      const res = await login(email('admin'));
      const cookie = cookieFrom(res)!;
      const out = await s.raw.post('/api/v1/auth/logout', {}, { headers: { Cookie: cookie, Origin: ORIGIN } });
      expect(out.status).toBe(204);
      expect(out.headers.getSetCookie().join(';')).toMatch(/mpe_rt=;/);
      expect((await refresh(cookie)).status).toBe(401);
      expect((await s.raw.post('/api/v1/auth/logout', {}, { headers: { Origin: ORIGIN } })).status).toBe(204);   // idempotent
    });

    it('deactivating a user locks them out immediately, without waiting for the token to expire', async () => {
      const client = await s.as('operator');
      expect((await client.get('/api/v1/auth/me')).status).toBe(200);
      await s.pool.query(`UPDATE users SET is_active = false WHERE email = $1`, [email('operator')]);
      expect((await client.get('/api/v1/auth/me')).status).toBe(401);
      expect((await refresh(client.cookie!)).status).toBe(401);
      await s.pool.query(`UPDATE users SET is_active = true WHERE email = $1`, [email('operator')]);
    });

    it('bumping token_version revokes every session of that user', async () => {
      const client = await s.as('warehouse');
      await s.pool.query(`UPDATE users SET token_version = token_version + 1 WHERE email = $1`, [email('warehouse')]);
      expect((await client.get('/api/v1/auth/me')).status).toBe(401);
      expect((await refresh(client.cookie!)).status).toBe(401);
    });
  });

  it('rejects missing, malformed and forged bearer tokens', async () => {
    expect((await s.raw.get('/api/v1/auth/me')).status).toBe(401);
    expect((await s.raw.get('/api/v1/auth/me', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await s.raw.get('/api/v1/auth/me', { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
  });

  it('prunes long-expired sessions and stale throttle rows', async () => {
    const { rows } = await s.pool.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
    await s.pool.query(`INSERT INTO refresh_tokens (family_id, user_id, token_hash, token_version, expires_at) VALUES (gen_random_uuid(), $1, 'old-hash', 0, clock_timestamp() - interval '30 days')`, [rows[0]!.id]);
    await s.pool.query(`INSERT INTO login_failures (identifier, failed_count, updated_at) VALUES ('stale@test.example', 1, clock_timestamp() - interval '3 days')`);
    const { createAuthService } = await import('../src/modules/auth/auth.service');
    const { authConfigFromEnv } = await import('../src/modules/auth/config');
    const { parseEnv } = await import('../src/config/env');
    const cfg = authConfigFromEnv(parseEnv({ DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'z'.repeat(40) }));
    expect(await createAuthService({ pool: s.pool, cfg }).pruneExpired()).toEqual({ tokens: 1, failures: 1 });
  });
});
