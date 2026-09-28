import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { newId } from './helpers/sync-client';
import { cookieFrom, jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('the owner manages the team', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient, otherAdmin: ApiClient;

  beforeAll(async () => { s = await startTestServer(); admin = await s.as('admin'); staff = await s.as('staff'); otherAdmin = await s.as('otheradmin'); });
  afterAll(async () => { await s.close(); });

  const api = (client: ApiClient) => ({
    get: (p: string) => client.get(`/api/v1/admin/team${p}`),
    post: (p: string, body: unknown = {}) => client.post(`/api/v1/admin/team${p}`, body),
    put: (p: string, body: unknown) => fetch(`${s.baseUrl}/api/v1/admin/team${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` }, body: JSON.stringify(body) }),
  });
  let nextEmail = 0;
  const newStaff = (over: Json = {}) =>
    api(admin).post('/users', { full_name: 'Rana Khalil', email: `staff-${++nextEmail}@example.com`, password: 'a good long password', role_key: 'staff', ...over });
  const login = (email: string) => s.raw.post('/api/v1/auth/login', { identifier: email, password: 'a good long password' });

  /** Signs in with a password we actually set (s.as() only knows the fixtures' own shared test password). */
  const signInAs = async (email: string, password: string): Promise<ApiClient> => {
    const res = await s.raw.post('/api/v1/auth/login', { identifier: email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
    const token = (await jsonOf<{ accessToken: string }>(res)).accessToken;
    const cookie = cookieFrom(res);
    return {
      token, cookie,
      get: (p: string) => fetch(`${s.baseUrl}${p}`, { headers: { Authorization: `Bearer ${token}` } }),
      post: (p: string, body?: unknown) => fetch(`${s.baseUrl}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body ?? {}) }),
    };
  };

  it('lists the seeded team with their real, effective permissions', async () => {
    const users = await jsonOf<Json[]>(await api(admin).get('/users'));
    const found = users.find((u) => u.email === 'staff@test.example');
    expect(found).toMatchObject({ role_key: 'staff', is_active: true, granted_permissions: [] });
    expect(found!.permissions).toContain('orders:create');
    expect(found!.permissions).not.toContain('orders:cancel');       // not in the default set
    expect(found!.permissions).not.toContain('*');
  });

  it('creates a staff member who can sign in with exactly the default permissions', async () => {
    const res = await newStaff({ full_name: 'Karim' });
    expect(res.status).toBe(201);
    const created = await jsonOf(res);
    expect(created).toMatchObject({ full_name: 'Karim', role_key: 'staff', is_active: true });
    expect(created.permissions).toEqual(expect.arrayContaining(['orders:create', 'customers:write', 'sync:use']));
    expect(created.permissions).not.toEqual(expect.arrayContaining(['content:manage', 'users:manage', 'products:write']));

    const signedIn = await login(`staff-${nextEmail}@example.com`);
    expect(signedIn.status).toBe(200);
  });

  it('a duplicate email is refused with a clear reason', async () => {
    await newStaff({ email: 'dup@example.com' });
    expect(await jsonOf(await newStaff({ email: 'dup@example.com' }))).toMatchObject({ error: 'invalid_request', message: 'email_in_use' });
  });

  it('is refused to a staff member: only the owner manages the team', async () => {
    expect((await api(staff).get('/users')).status).toBe(403);
    expect((await api(staff).post('/users', { full_name: 'x', email: 'x@example.com', password: 'a good long password', role_key: 'staff' })).status).toBe(403);
  });

  describe('delegated permissions', () => {
    it('grants exactly what the owner ticks, nothing more, and it works without a new login', async () => {
      const created = await jsonOf(await newStaff());
      const client = await signInAs(created.email, 'a good long password');

      // before the grant: refused
      const before = await client.get('/api/v1/auth/me');
      expect(before.status).toBe(200);   // sanity: the token itself works
      expect((await jsonOf(before)).permissions).not.toContain('orders:cancel')

      const granted = await api(admin).put(`/users/${created.id}`, { row_version: created.row_version, data: { granted_permissions: ['orders:cancel'] } });
      expect(granted.status).toBe(200);
      expect(await jsonOf(granted)).toMatchObject({ permissions: expect.arrayContaining(['orders:cancel']) });

      // the SAME already-issued token now carries the extra permission: no re-login needed
      const me = await client.get('/api/v1/auth/me');
      expect((await jsonOf(me)).permissions).toContain('orders:cancel');
    });

    it('refuses a permission that is not on the delegable list', async () => {
      const res = await newStaff({ granted_permissions: ['users:manage'] });
      expect(res.status).toBe(400);
    });

    it('the database itself refuses a disallowed value, even bypassing the API', async () => {
      const created = await jsonOf(await newStaff());
      await expect(s.pool.query(`UPDATE users SET granted_permissions = ARRAY['users:manage'] WHERE id = $1`, [created.id]))
        .rejects.toMatchObject({ code: '23514' });   // CHECK violation
      await expect(s.pool.query(`UPDATE users SET granted_permissions = ARRAY['orders:cancel'] WHERE id = $1`, [created.id])).resolves.toBeDefined();
    });
  });

  describe('the last admin can never be locked out', () => {
    it('refuses to deactivate or demote the only admin', async () => {
      const me = await jsonOf<Json[]>(await api(admin).get('/users')).then((list) => list.find((u) => u.email === 'admin@test.example')!);
      expect(await jsonOf(await api(admin).put(`/users/${me.id}`, { row_version: me.row_version, data: { is_active: false } }))).toMatchObject({ message: 'last_admin' });
      expect(await jsonOf(await api(admin).put(`/users/${me.id}`, { row_version: me.row_version, data: { role_key: 'staff' } }))).toMatchObject({ message: 'last_admin' });
    });

    it('allows it once a second admin exists', async () => {
      const secondEmail = `second-${Date.now()}@example.com`;
      await newStaff({ role_key: 'admin', email: secondEmail });
      const second = await signInAs(secondEmail, 'a good long password');
      const me = await jsonOf<Json[]>(await api(admin).get('/users')).then((list) => list.find((u) => u.email === 'admin@test.example')!);

      const res = await api(admin).put(`/users/${me.id}`, { row_version: me.row_version, data: { is_active: false } });
      expect(res.status).toBe(200);

      // restore, from the second admin's own session, so every later test still has its usual working `admin` fixture
      try {
        const fresh = await jsonOf<Json[]>(await api(second).get('/users')).then((list) => list.find((u) => u.id === me.id)!);
        const restored = await api(second).put(`/users/${me.id}`, { row_version: fresh.row_version, data: { is_active: true } });
        expect(restored.status).toBe(200);
      } catch (err) {
        throw new Error(`failed to restore the admin fixture after deactivating it: ${String(err)}`);
      }
    });
  });

  it('refuses a save made over someone else\'s newer change', async () => {
    const created = await jsonOf(await newStaff());
    const first = await api(admin).put(`/users/${created.id}`, { row_version: created.row_version, data: { full_name: 'New Name' } });
    expect(first.status).toBe(200);
    const stale = await api(admin).put(`/users/${created.id}`, { row_version: created.row_version, data: { full_name: 'Someone Else' } });
    expect(stale.status).toBe(409);
  });

  it('resetting a password signs the person out everywhere, including their current session', async () => {
    const created = await jsonOf(await newStaff());
    const client = await signInAs(created.email, 'a good long password');
    expect((await client.get('/api/v1/auth/me')).status).toBe(200);

    expect((await api(admin).post(`/users/${created.id}/reset-password`, { password: 'a brand new long password' })).status).toBe(204);
    expect((await client.get('/api/v1/auth/me')).status).toBe(401);
    expect((await login(created.email)).status).toBe(401);   // old password no longer works
    expect((await s.raw.post('/api/v1/auth/login', { identifier: created.email, password: 'a brand new long password' })).status).toBe(200);
  });

  it('ending sessions signs the person out without touching their password', async () => {
    const created = await jsonOf(await newStaff());
    const client = await signInAs(created.email, 'a good long password');
    expect((await api(admin).post(`/users/${created.id}/end-sessions`)).status).toBe(204);
    expect((await client.get('/api/v1/auth/me')).status).toBe(401);
    expect((await login(created.email)).status).toBe(200);   // the same password still works
  });

  describe('the audit log', () => {
    it('records what the owner did, newest first, without ever recording a password', async () => {
      const created = await jsonOf(await newStaff({ full_name: 'Logged Person' }));
      await api(admin).post(`/users/${created.id}/reset-password`, { password: 'a brand new long password' });
      const log = await jsonOf<Json[]>(await api(admin).get('/audit-log?limit=5'));
      expect(log[0]).toMatchObject({ action: 'user.password_reset', target_id: created.id, actor_name: expect.any(String) });
      expect(log.some((e) => e.action === 'user.created' && e.target_id === created.id)).toBe(true);
      expect(JSON.stringify(log)).not.toContain('a brand new long password');
    });

    it('is refused to a staff member', async () => {
      expect((await api(staff).get('/audit-log')).status).toBe(403);
    });
  });

  describe('the shop\'s discount-cap setting', () => {
    it('the owner sets it, staff cannot, and it takes a version', async () => {
      const current = await jsonOf(await api(admin).get('/branch-settings'));
      expect(current.max_discount_percent).toBeNull();
      const saved = await api(admin).put('/branch-settings', { row_version: current.row_version, data: { max_discount_percent: 12.5 } });
      expect(await jsonOf(saved)).toMatchObject({ max_discount_percent: '12.50' });
      expect((await api(staff).put('/branch-settings', { row_version: current.row_version, data: { max_discount_percent: 5 } })).status).toBe(403);
      const stale = await api(admin).put('/branch-settings', { row_version: current.row_version, data: { max_discount_percent: 20 } });
      expect(stale.status).toBe(409);
      await api(admin).put('/branch-settings', { row_version: (await jsonOf(await api(admin).get('/branch-settings'))).row_version, data: { max_discount_percent: null } });
    });
  });

  describe('the owner\'s own password', () => {
    it('is refused with the wrong current password, and never signs the person out', async () => {
      const solo = await s.as('otheradmin');
      const res = await fetch(`${s.baseUrl}/api/v1/auth/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${solo.token}` }, body: JSON.stringify({ current_password: 'wrong', new_password: 'a brand new long password' }) });
      expect(res.status).toBe(401);
      expect((await solo.get('/api/v1/auth/me')).status).toBe(200);
    });

    it('changes it, keeps this session working, and signs every other device out', async () => {
      const deviceA = await s.as('otheradmin');
      const deviceB = await s.as('otheradmin');
      const res = await fetch(`${s.baseUrl}/api/v1/auth/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceA.token}` }, body: JSON.stringify({ current_password: 'correct horse battery staple', new_password: 'a brand new long password' }) });
      expect(res.status).toBe(200);
      expect((await deviceB.get('/api/v1/auth/me')).status).toBe(401);
      // client() closures capture their token at creation time, so the fresh token from the response is used
      // with a direct fetch rather than by trying to patch it onto the old `deviceA` client object.
      const newToken = (await jsonOf<{ accessToken: string }>(res)).accessToken;
      const stillA = await fetch(`${s.baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${newToken}` } });
      expect(stillA.status).toBe(200);
      expect((await login('otheradmin@test.example')).status).toBe(401);
      expect((await s.raw.post('/api/v1/auth/login', { identifier: 'otheradmin@test.example', password: 'a brand new long password' })).status).toBe(200);
    });
  });
});
