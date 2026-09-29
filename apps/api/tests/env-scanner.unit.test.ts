import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';

const base = { DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('the virus scanner settings', () => {
  it('are off by default', () => {
    expect(parseEnv(base).CLAMAV_HOST).toBeUndefined();
  });
  it('treat a blank line in .env as off, and never stop the server from starting', () => {
    const env = parseEnv({ ...base, CLAMAV_HOST: '' });
    expect(Boolean(env.CLAMAV_HOST)).toBe(false);
  });
  it('read the host, with the standard clamd port and a generous timeout by default', () => {
    expect(parseEnv({ ...base, CLAMAV_HOST: 'clamav' })).toMatchObject({ CLAMAV_HOST: 'clamav', CLAMAV_PORT: 3310, CLAMAV_TIMEOUT_MS: 60000 });
  });
  it('refuse a nonsense port instead of silently scanning nothing', () => {
    expect(() => parseEnv({ ...base, CLAMAV_HOST: 'clamav', CLAMAV_PORT: '99999' })).toThrow();
  });
});
