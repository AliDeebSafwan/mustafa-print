import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';

const secret = 'a-real-secret-generated-for-this-server-'.padEnd(48, 'x');
const production = {
  NODE_ENV: 'production', DATABASE_URL: 'postgres://db', JWT_ACCESS_SECRET: secret,
  PUBLIC_WEB_URL: 'https://almustafa-print.com', CORS_ORIGINS: 'https://app.almustafa-print.com',
};

describe('production configuration', () => {
  it('starts with real https addresses', () => {
    const env = parseEnv(production);
    expect(env.PUBLIC_WEB_URL).toBe('https://almustafa-print.com');
    expect(env.CORS_ORIGINS).toEqual(['https://app.almustafa-print.com']);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('refuses to start on the development defaults instead of sending customers links to localhost', () => {
    const { PUBLIC_WEB_URL: _site, CORS_ORIGINS: _origins, ...forgotten } = production;
    expect(() => parseEnv(forgotten)).toThrow(/PUBLIC_WEB_URL: must be the website's public https address[\s\S]*CORS_ORIGINS: must list public https origins/);
  });

  it('refuses plain http or loopback addresses, which browsers would block as mixed content', () => {
    expect(() => parseEnv({ ...production, PUBLIC_WEB_URL: 'http://almustafa-print.com' })).toThrow(/PUBLIC_WEB_URL/);
    expect(() => parseEnv({ ...production, CORS_ORIGINS: 'https://app.almustafa-print.com,http://127.0.0.1:5173' })).toThrow(/not: http:\/\/127\.0\.0\.1:5173/);
  });

  it('refuses the JWT secret published in the example file: anyone could sign an admin token with it', () => {
    expect(() => parseEnv({ ...production, JWT_ACCESS_SECRET: '1q2w3e4r5t6y7u8i9o0p1a2s3d4f5g6h7j8k9l0zxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM' }))
      .toThrow(/JWT_ACCESS_SECRET: is the published example value/);
  });

  it('still allows local production-mode testing over http when that is said explicitly', () => {
    const local = { ...production, COOKIE_SECURE: 'false', PUBLIC_WEB_URL: 'http://localhost:3380', CORS_ORIGINS: 'http://localhost:4173' };
    expect(parseEnv(local).COOKIE_SECURE).toBe(false);
  });

  it('never accepts a wildcard origin, in any environment', () => {
    expect(() => parseEnv({ ...production, CORS_ORIGINS: '*' })).toThrow(/"\*" is not allowed/);
    expect(() => parseEnv({ DATABASE_URL: 'postgres://db', JWT_ACCESS_SECRET: secret, CORS_ORIGINS: '*' })).toThrow(/"\*" is not allowed/);
  });

  it('leaves development exactly as it was: localhost defaults, insecure cookies', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://db', JWT_ACCESS_SECRET: secret });
    expect(env.PUBLIC_WEB_URL).toBe('http://localhost:3000');
    expect(env.COOKIE_SECURE).toBe(false);
  });
});
