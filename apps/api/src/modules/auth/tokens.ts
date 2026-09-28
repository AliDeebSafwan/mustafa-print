import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { AuthConfig } from './types';

const ISSUER = 'mpe-api';
const AUDIENCE = 'mpe-staff';
const secretKey = (secret: string) => new TextEncoder().encode(secret);

export interface AccessClaims { userId: string; branchId: string; role: string; tokenVersion: number }

/** Short-lived, stateless. It only says who the user is; permissions are resolved server-side on every request. */
export function signAccessToken(cfg: Pick<AuthConfig, 'accessSecret' | 'accessTtlSeconds'>, claims: AccessClaims): Promise<string> {
  return new SignJWT({ bid: claims.branchId, role: claims.role, tv: claims.tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${cfg.accessTtlSeconds}s`)
    .sign(secretKey(cfg.accessSecret));
}

/** Throws on a bad signature, wrong issuer/audience, expiry, or malformed claims. */
export async function verifyAccessToken(cfg: Pick<AuthConfig, 'accessSecret'>, token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secretKey(cfg.accessSecret), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
  const { sub, bid, role, tv } = payload;
  if (typeof sub !== 'string' || typeof bid !== 'string' || typeof role !== 'string' || typeof tv !== 'number') throw new Error('malformed access token');
  return { userId: sub, branchId: bid, role, tokenVersion: tv };
}

/** Opaque 256-bit secret handed to the browser in an httpOnly cookie. */
export const generateRefreshToken = (): string => randomBytes(32).toString('base64url');

/** Only this hash is stored, so a database leak does not leak usable sessions. (High-entropy input: a fast hash is appropriate.) */
export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');
