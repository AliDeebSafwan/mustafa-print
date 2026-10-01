import { z } from 'zod';

/**
 * This codebase never generates code from strings at runtime. zod 4 would, to speed up parsing: it compiles object
 * schemas with `new Function()` after probing whether the environment allows it. The staff app's Content-Security-Policy
 * forbids that (a violation on every page), and hosting scanners rightly treat runtime code generation as a red flag.
 * Jitless parsing gives the same results; the payloads here (forms, sync records) are small, so the speed-up is moot.
 *
 * Imported first by the package entry, so it is in effect before any schema is used.
 */
z.config({ jitless: true });
