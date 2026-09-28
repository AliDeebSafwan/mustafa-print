import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env';
import { HttpError } from '../src/http-error';
import { readCookie } from '../src/modules/auth/cookies';
import { normalizeIdentifier } from '../src/modules/auth/identifier';
import { requireAllowedOrigin, requirePermission } from '../src/modules/auth/middleware';
import { hashPassword, verifyPassword } from '../src/modules/auth/password';
import { generateRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken } from '../src/modules/auth/tokens';
import { roleDefinition } from '@mpe/shared';

const cfg = { accessSecret: 'a'.repeat(48), accessTtlSeconds: 900 };
const claims = { userId: '11111111-1111-4111-8111-111111111111', branchId: '22222222-2222-4222-8222-222222222222', role: 'admin', tokenVersion: 3 };

describe('login identifiers', () => {
  it('normalises emails and phone numbers to one canonical form', () => {
    expect(normalizeIdentifier('  Ali@Example.COM ')).toBe('ali@example.com');
    expect(normalizeIdentifier('+961 70 123 456')).toBe('+96170123456');
    expect(normalizeIdentifier('0096170123456')).toBe('+96170123456');
    expect(normalizeIdentifier('(+961) 70-123-456')).toBe('+96170123456');
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '12345', 'not an@email', '+0123456789', "x'; DROP TABLE users;--"]) expect(normalizeIdentifier(bad)).toBeNull();
  });
});

describe('access tokens', () => {
  it('round-trips claims', async () => {
    expect(await verifyAccessToken(cfg, await signAccessToken(cfg, claims))).toEqual(claims);
  });
  it('rejects a wrong secret, a tampered token and garbage', async () => {
    const token = await signAccessToken(cfg, claims);
    await expect(verifyAccessToken({ accessSecret: 'b'.repeat(48) }, token)).rejects.toThrow();
    const [h, p, s] = token.split('.');
    await expect(verifyAccessToken(cfg, `${h}.${p!.slice(0, -2)}AA.${s}`)).rejects.toThrow();
    await expect(verifyAccessToken(cfg, 'nope')).rejects.toThrow();
  });
  it('rejects an expired token and one for another audience', async () => {
    const key = new TextEncoder().encode(cfg.accessSecret);
    const base = () => new SignJWT({ bid: claims.branchId, role: 'admin', tv: 3 }).setProtectedHeader({ alg: 'HS256' }).setSubject(claims.userId).setIssuer('mpe-api');
    await expect(verifyAccessToken(cfg, await base().setAudience('mpe-staff').setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key))).rejects.toThrow();
    await expect(verifyAccessToken(cfg, await base().setAudience('someone-else').setExpirationTime('5m').sign(key))).rejects.toThrow();
  });
  it('refuses tokens signed with alg "none"', async () => {
    const forged = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: claims.userId, bid: claims.branchId, role: 'admin', tv: 3, iss: 'mpe-api', aud: 'mpe-staff' })).toString('base64url')}.`;
    await expect(verifyAccessToken(cfg, forged)).rejects.toThrow();
  });
});

describe('refresh tokens', () => {
  it('are long, unique, and stored only as a hash', () => {
    const a = generateRefreshToken(); const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toContain(a);
  });
});

describe('passwords', () => {
  it('hash with argon2id and verify', async () => {
    const hash = await hashPassword('s3cret-pass-phrase');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 's3cret-pass-phrase')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
  it('never succeeds for a missing account or a malformed hash', async () => {
    expect(await verifyPassword(null, 'anything')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('cookies', () => {
  it('reads the named cookie among others and survives malformed input', () => {
    expect(readCookie('a=1; mpe_rt=abc%2D123; b=2', 'mpe_rt')).toBe('abc-123');
    expect(readCookie(undefined, 'mpe_rt')).toBeUndefined();
    expect(readCookie('mpe_rt=%E0%A4%A', 'mpe_rt')).toBeUndefined();
  });
});

describe('guards', () => {
  const run = (mw: (req: never, res: never, next: () => void) => void, req: object) => { const next = vi.fn(); let error: unknown; try { mw(req as never, {} as never, next); } catch (e) { error = e; } return { next, error }; };

  it('requirePermission allows wildcards and named permissions, rejects the rest', () => {
    const req = (key: string) => ({ auth: { role: roleDefinition(key) } });
    expect(run(requirePermission('orders:cancel'), req('admin')).next).toHaveBeenCalled();
    expect(run(requirePermission('orders:create'), req('receptionist')).next).toHaveBeenCalled();
    const denied = run(requirePermission('orders:cancel'), req('receptionist'));
    expect(denied.error).toMatchObject({ status: 403, code: 'forbidden' });
    expect(denied.next).not.toHaveBeenCalled();
    expect(run(requirePermission('orders:read'), {}).error).toMatchObject({ status: 401 });
  });
  it('requireAllowedOrigin blocks foreign origins but lets same-origin/no-origin calls through', () => {
    const mw = requireAllowedOrigin(['https://admin.example.com']);
    const withOrigin = (origin?: string) => ({ get: (h: string) => (h === 'origin' ? origin : undefined) });
    expect(run(mw, withOrigin('https://admin.example.com')).next).toHaveBeenCalled();
    expect(run(mw, withOrigin()).next).toHaveBeenCalled();
    expect(run(mw, withOrigin('https://evil.example')).error).toBeInstanceOf(HttpError);
  });
});

describe('environment', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'y'.repeat(40) };
  it('requires a strong access secret', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgres://x' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
  });
  it('turns secure cookies on in production unless overridden', () => {
    expect(parseEnv({ ...base, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(parseEnv({ ...base, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
    expect(parseEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });
});
