import type { Env } from '../../config/env';
import type { AuthConfig } from './types';

export const authConfigFromEnv = (env: Env): AuthConfig => ({
  accessSecret: env.JWT_ACCESS_SECRET,
  accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  cookieSecure: env.COOKIE_SECURE,
  maxFailedLogins: 5,
  lockMinutes: 15,
  refreshGraceSeconds: 10,
});
