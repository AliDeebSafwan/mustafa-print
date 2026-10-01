import { normalizePhone } from '@mpe/shared';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Canonical form of what the user typed: lower-cased email, or an E.164 phone number. A phone goes through the same
 * normalizePhone the staff screens use when they SAVE a number, so whatever form a person types at sign-in
 * ("71 222 333", "03 123456", "+961 71 222 333", "00961...", Arabic-Indic digits) finds the account stored as
 * "+96171222333". Returns null when it is neither (the login then fails like any other wrong credential).
 */
export function normalizeIdentifier(raw: string, defaultCallingCode = '961'): string | null {
  const value = raw.trim();
  if (value.includes('@')) return EMAIL.test(value) ? value.toLowerCase() : null;
  return normalizePhone(value, defaultCallingCode);
}
