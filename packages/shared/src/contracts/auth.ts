import { z } from 'zod';
import { LOCALES } from '../util/locales';
import { ROLE_KEYS } from '../rules/permissions';

export const loginRequestSchema = z.object({
  identifier: z.string().trim().min(3).max(254),     // email or phone number
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  role: z.enum(ROLE_KEYS),
  branchId: z.string().uuid(),
  locale: z.enum(LOCALES),
  permissions: z.array(z.string()),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/**
 * The branch the person works in, and the rules the shop set for it. Sent with the session so a device knows them
 * even after it goes offline. The server enforces these rules regardless; the device uses them to warn early.
 */
export const sessionBranchSchema = z.object({
  id: z.string().uuid(),
  nameAr: z.string(),
  nameEn: z.string(),
  baseCurrency: z.string().length(3),
  /** Largest discount staff may give without a manager, as a percent of the subtotal. null = no limit set. */
  maxDiscountPercent: z.number().nullable(),
  /** For the invoice header. Blank names fall back to nameAr/nameEn; VAT is off (rate ignored) until the owner turns it on. */
  legalNameAr: z.string().nullable(),
  legalNameEn: z.string().nullable(),
  taxNumber: z.string().nullable(),
  vatEnabled: z.boolean(),
  vatRatePercent: z.number(),
  invoiceFooterAr: z.string().nullable(),
  invoiceFooterEn: z.string().nullable(),
  /** A deposit required before a job may start printing. 0 percent means the rule is off. */
  depositPercent: z.number(),
  depositThreshold: z.number().nullable(),
});
export type SessionBranch = z.infer<typeof sessionBranchSchema>;

/** Response of login and refresh. The refresh token travels ONLY in an httpOnly cookie, never in JSON. */
export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),           // seconds
  user: sessionUserSchema,
  branch: sessionBranchSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const API_ERROR_CODES = [
  'invalid_request', 'invalid_credentials', 'too_many_attempts', 'unauthorized', 'invalid_token', 'forbidden',
  'invalid_refresh', 'refresh_race', 'origin_not_allowed', 'not_found', 'invalid_cursor', 'internal_error',
  // content management
  'version_conflict', 'slug_taken', 'media_in_use', 'missing_alt_text', 'invalid_image',
  // customer accounts
  'email_not_verified',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
