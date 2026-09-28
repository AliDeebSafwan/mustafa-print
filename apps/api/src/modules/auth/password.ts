import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** argon2id with the library's recommended defaults. */
export const hashPassword = (password: string): Promise<string> => hash(password);

let decoy: Promise<string> | undefined;

/**
 * Always performs a full verification, even when the account does not exist, so response time never reveals
 * which identifiers are registered. Returns false for missing accounts and for malformed stored hashes.
 */
export async function verifyPassword(storedHash: string | null | undefined, password: string): Promise<boolean> {
  const target = storedHash ?? (await (decoy ??= hash(randomBytes(16).toString('hex'))));
  try {
    const matches = await verify(target, password);
    return matches && Boolean(storedHash);
  } catch {
    return false;
  }
}
