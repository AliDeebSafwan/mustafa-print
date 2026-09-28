import type { Response } from 'express';
import type { AuthConfig } from './types';

export const REFRESH_COOKIE = 'mpe_rt';
/** Scoped to the auth endpoints: the browser never attaches the refresh token to any other request. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

const base = (cfg: Pick<AuthConfig, 'cookieSecure'>) => ({ httpOnly: true, secure: cfg.cookieSecure, sameSite: 'strict' as const, path: REFRESH_COOKIE_PATH });

export function setRefreshCookie(res: Response, token: string, cfg: Pick<AuthConfig, 'cookieSecure' | 'refreshTtlDays'>): void {
  res.cookie(REFRESH_COOKIE, token, { ...base(cfg), maxAge: cfg.refreshTtlDays * 24 * 60 * 60 * 1000 });
}

export function clearRefreshCookie(res: Response, cfg: Pick<AuthConfig, 'cookieSecure'>): void {
  res.clearCookie(REFRESH_COOKIE, base(cfg));
}
