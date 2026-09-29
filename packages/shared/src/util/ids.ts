// Client-side id helpers. Offline devices must be able to mint ids without asking the server.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // 32 symbols, no I L O U

/** Random, unguessable code for barcodes and tracking URLs. 12 chars = 60 bits. */
export function generatePublicCode(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CROCKFORD[b & 31]; // 256 % 32 === 0 -> no modulo bias
  return out;
}
export const PUBLIC_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10,16}$/;

/** UUIDv7: time-ordered, so IDB/Postgres indexes stay append-friendly. */
export function uuidv7(now: number = Date.now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  // 48-bit millisecond timestamp, big-endian (plain arithmetic: no BigInt, so old tablet browsers are fine)
  b[0] = Math.floor(now / 2 ** 40) & 0xff;
  b[1] = Math.floor(now / 2 ** 32) & 0xff;
  b[2] = Math.floor(now / 2 ** 24) & 0xff;
  b[3] = Math.floor(now / 2 ** 16) & 0xff;
  b[4] = Math.floor(now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70; // version 7
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}
