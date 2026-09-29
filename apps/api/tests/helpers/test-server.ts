import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import pino from 'pino';
import { ROLE_DEFINITIONS, type RoleKey } from '@mpe/shared';
import { createApp } from '../../src/app';
import { parseEnv } from '../../src/config/env';
import { hashPassword } from '../../src/modules/auth/password';
import { createTestDatabase, type TestDatabase } from './test-db';

export const PASSWORD = 'correct horse battery staple';
export const ORIGIN = 'http://localhost:5173';
export const SECRET = 'test-secret-'.padEnd(48, 'x');

export interface StaffUser { id: string; email: string; role: RoleKey; branchId: string }
export interface Fixtures {
  branchId: string;
  otherBranchId: string;
  users: Record<'admin' | 'staff' | 'receptionist' | 'operator' | 'warehouse' | 'otherAdmin', StaffUser>;
}

/** Two branches, the five system roles, and one user per role (plus an admin in the other branch). */
export async function seedFixtures(pool: pg.Pool): Promise<Fixtures> {
  for (const r of ROLE_DEFINITIONS) {
    await pool.query(
      `INSERT INTO roles (key, name_ar, name_en, permissions, is_system) VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (key) DO UPDATE SET permissions = EXCLUDED.permissions`, [r.key, r.name_ar, r.name_en, [...r.permissions]]);
  }
  const branch = async (code: string) => (await pool.query<{ id: string }>(
    `INSERT INTO branches (code, name_ar, name_en) VALUES ($1, $1, $1) RETURNING id`, [code])).rows[0]!.id;
  const branchId = await branch('MAIN');
  const otherBranchId = await branch('OTHER');

  const passwordHash = await hashPassword(PASSWORD);   // hashed once: argon2 is deliberately slow
  const make = async (name: string, role: RoleKey, inBranch: string): Promise<StaffUser> => {
    const email = `${name}@test.example`;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (branch_id, role_id, full_name, email, password_hash)
       VALUES ($1, (SELECT id FROM roles WHERE key = $2), $3, $4, $5) RETURNING id`, [inBranch, role, name, email, passwordHash]);
    return { id: rows[0]!.id, email, role, branchId: inBranch };
  };
  return {
    branchId, otherBranchId,
    users: {
      admin: await make('admin', 'admin', branchId),
      staff: await make('staff', 'staff', branchId),
      receptionist: await make('receptionist', 'receptionist', branchId),
      operator: await make('operator', 'machine_operator', branchId),
      warehouse: await make('warehouse', 'warehouse_manager', branchId),
      otherAdmin: await make('otheradmin', 'admin', otherBranchId),
    },
  };
}

/** An email the server would have sent; tests read verification and reset links from these. */
export interface SentEmail { to: string; subject: string | null | undefined; body: string; locale: string }

export interface TestServer {
  db: TestDatabase;
  /** Every email sent, newest last. */
  emails: SentEmail[];
  /** The link in the newest email to this address. */
  linkFor(to: string): string;
  /** Where this server keeps uploaded pictures; removed on close. */
  mediaDir: string;
  pool: pg.Pool;
  baseUrl: string;
  fixtures: Fixtures;
  close(): Promise<void>;
  /** Signs in and returns a ready-to-use client. */
  as(user: StaffUser | string): Promise<ApiClient>;
  raw: ApiClient;
}

export interface ApiClient {
  token?: string;
  cookie?: string;
  get(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, body?: unknown, init?: { headers?: Record<string, string> }): Promise<Response>;
}

const client = (baseUrl: string, auth: { token?: string; cookie?: string } = {}): ApiClient => {
  const send = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...(auth.cookie ? { Cookie: auth.cookie } : {}),
        ...extra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return {
    ...auth,
    get: (path, init) => send('GET', path, undefined, init?.headers as Record<string, string> | undefined),
    post: (path, body, init) => send('POST', path, body ?? {}, init?.headers),
  };
};
/** Typed access to a JSON response body (fetch() types it as unknown). */
export const jsonOf = <T = Record<string, any>>(res: Response): Promise<T> => res.json() as Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const cookieFrom = (res: Response): string | undefined => res.headers.getSetCookie().find((c) => c.startsWith('mpe_rt='))?.split(';')[0];

export async function startTestServer(overrides: Record<string, string> = {}, opts: { pushAgent?: import('node:https').Agent; pushAllowedHosts?: readonly string[]; scanner?: import('../../src/modules/media/virus-scan').FileScanner } = {}): Promise<TestServer> {
  const db = await createTestDatabase();
  const fixtures = await seedFixtures(db.pool);
  const mediaDir = await mkdtemp(path.join(tmpdir(), 'mpe-media-'));
  const env = parseEnv({
    DATABASE_URL: db.url, JWT_ACCESS_SECRET: SECRET, COOKIE_SECURE: 'false', SYNC_PULL_LAG_SECONDS: '0', MEDIA_DIR: mediaDir,
    NODE_ENV: 'test', CORS_ORIGINS: ORIGIN, PUBLIC_WEB_URL: 'https://print.example.com', ...overrides,
  });
  const emails: SentEmail[] = [];
  const mailer = {
    channel: 'email' as const, name: 'test',
    async send(m: { to: string; subject?: string | null; body: string; locale: string }) {
      emails.push({ to: m.to, subject: m.subject, body: m.body, locale: m.locale });
      return { ok: true as const, provider: 'test', providerMessageId: `t-${emails.length}` };
    },
  };
  const linkFor = (to: string) => {
    const mail = [...emails].reverse().find((e) => e.to === to);
    const link = mail?.body.match(/https?:\/\/\S+/)?.[0];
    if (!link) throw new Error(`no email with a link was sent to ${to}`);
    return link;
  };
  const { app } = createApp({ pool: db.pool, env, log: pino({ level: process.env.LOG_LEVEL === "debug" ? "debug" : "silent" }), mailer, pushAgent: opts.pushAgent, pushAllowedHosts: opts.pushAllowedHosts, scanner: opts.scanner });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const all = Object.values(fixtures.users);
  const as = async (who: StaffUser | string) => {
    const user = typeof who === 'string' ? all.find((u) => u.email === `${who}@test.example`)! : who;
    const res = await client(baseUrl).post('/api/v1/auth/login', { identifier: user.email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${user.email}: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { accessToken: string };
    return client(baseUrl, { token: body.accessToken, cookie: cookieFrom(res) });
  };

  return {
    db, pool: db.pool, baseUrl, fixtures, as, raw: client(baseUrl), mediaDir, emails, linkFor,
    async close() { await new Promise<void>((r) => server.close(() => r())); await db.drop(); await rm(mediaDir, { recursive: true, force: true }); },
  };
}
