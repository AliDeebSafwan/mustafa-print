import { describe, expect, it } from 'vitest';
import { isLeakedSecret, parseEnv } from '../src/config/env';

/**
 * `apps/api/.env.example` used to ship a working JWT signing secret, and the README tells a new machine to copy that
 * file. Anyone who did is signing staff tokens with a key published on GitHub. These tests pin the guard that stops
 * such a deployment from starting at all.
 */
const LEAKED_JWT = '1q2w3e4r5t6y7u8i9o0p1a2s3d4f5g6h7j8k9l0zxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM';
const base = { DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('secrets this repository has already published', () => {
  it('are recognised, whatever setting they arrive in', () => {
    expect(isLeakedSecret(LEAKED_JWT)).toBe(true);
    expect(isLeakedSecret('71712981Ali1')).toBe(true);
  });

  it('do not flag a freshly generated secret', () => {
    expect(isLeakedSecret('x'.repeat(40))).toBe(false);
    expect(isLeakedSecret('')).toBe(false);
  });

  it('stop the server from starting when used to sign tokens', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: LEAKED_JWT })).toThrow(/public/);
  });

  it('stop the server from starting when used for any other secret', () => {
    expect(() => parseEnv({ ...base, WEB_REVALIDATE_URL: 'http://localhost:3000/api/revalidate', WEB_REVALIDATE_SECRET: LEAKED_JWT })).toThrow(/public/);
  });

  it('leave a valid configuration alone', () => {
    expect(parseEnv(base).JWT_ACCESS_SECRET).toBe('x'.repeat(40));
  });
});
