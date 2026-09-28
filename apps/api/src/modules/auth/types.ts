import type { Locale, RoleDefinition } from '@mpe/shared';

/** Who is calling. Built by the authenticate middleware from the database, never trusted from the token alone. */
export interface AuthContext {
  userId: string;
  branchId: string;
  fullName: string;
  locale: Locale;
  role: RoleDefinition;
}

export interface AuthConfig {
  accessSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  cookieSecure: boolean;
  /** Consecutive failures before an identifier is locked. */
  maxFailedLogins: number;
  lockMinutes: number;
  /** A just-rotated refresh token may be presented again for this long (two tabs racing) without being treated as theft. */
  refreshGraceSeconds: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}
