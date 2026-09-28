/**
 * What code running in a customer's browser may import at runtime. Everything here is zod-free: the main entry pulls
 * in every validation schema (and zod's messages in every language), ~100 KB a phone downloads for nothing.
 * Types are still imported from '@mpe/shared' with `import type`, which costs nothing at runtime.
 */
export { unitPriceFor } from './money';
export { normalizePhone } from './phone';
export { PUBLIC_CODE_RE } from './ids';
export { LOCALES } from './locales';
export { PASSWORD_MIN } from './limits';
