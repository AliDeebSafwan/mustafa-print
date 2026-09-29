const EASTERN_ARABIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Staff on Arabic keyboards type ٠٣١٢٣٤٥٦; the rest of the system works with 0-9. */
export function toWesternDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => String(EASTERN_ARABIC.includes(ch) ? EASTERN_ARABIC.indexOf(ch) : PERSIAN.indexOf(ch)));
}

/**
 * Turns whatever the cashier typed into E.164, or null when it cannot be a phone number.
 *   "03 123 456", "70123456", "+961 70 123 456", "0096170123456", "٠٣١٢٣٤٥٦"  ->  +961...
 * Numbers without a country code get `defaultCallingCode` (Lebanon: 961). A number that already starts with it and is long
 * enough is treated as international ("96170123456"). Leading zeros are the national trunk prefix and are dropped.
 */
export function normalizePhone(raw: string, defaultCallingCode = '961'): string | null {
  const cleaned = toWesternDigits(raw).trim().replace(/[\s().-]/g, '');
  if (!cleaned) return null;

  let e164: string;
  if (cleaned.startsWith('+')) e164 = cleaned;
  else if (cleaned.startsWith('00')) e164 = `+${cleaned.slice(2)}`;
  else if (cleaned.startsWith(defaultCallingCode) && cleaned.length >= defaultCallingCode.length + 7) e164 = `+${cleaned}`;
  else e164 = `+${defaultCallingCode}${cleaned.replace(/^0+/, '')}`;

  return /^\+[1-9][0-9]{6,14}$/.test(e164) ? e164 : null;
}
