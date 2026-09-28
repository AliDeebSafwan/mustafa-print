const E164 = /^\+[1-9][0-9]{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Canonical form of what the user typed: lower-cased email, or an E.164 phone number ("00961 70 123 456" -> "+96170123456").
 * Returns null when it is neither (the login then fails like any other wrong credential).
 */
export function normalizeIdentifier(raw: string): string | null {
  const value = raw.trim();
  if (value.includes('@')) return EMAIL.test(value) ? value.toLowerCase() : null;
  const digits = value.replace(/[\s().-]/g, '');
  const phone = digits.startsWith('00') ? `+${digits.slice(2)}` : digits;
  return E164.test(phone) ? phone : null;
}
