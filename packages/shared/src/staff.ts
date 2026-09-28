import { z } from 'zod';
import { LOCALES } from './locales';
import { PASSWORD_MAX, PASSWORD_MIN } from './customer-account';
import { TOGGLEABLE_PERMISSIONS } from './permissions';

/**
 * Managing the team and the shop's business settings — the owner's own tools, never queued offline (this is office
 * work done at a desk, not the shop floor). Shared with the server so what a form accepts is what the server accepts.
 */

const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
const email = z.string().trim().toLowerCase().email().max(254);
const phone = z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/, 'international format, e.g. +96170123456');
const name = z.string().trim().min(1).max(200);

/** The two roles this shop's staff screen offers. Other roles exist in the system (for a larger shop's floor
 *  and warehouse flows) but are not created from this simple screen. */
export const ASSIGNABLE_ROLES = ['admin', 'staff'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const grantedPermissions = z.array(z.enum(TOGGLEABLE_PERMISSIONS)).max(TOGGLEABLE_PERMISSIONS.length)
  .refine((v) => new Set(v).size === v.length, 'a permission appears twice');

export const staffCreateInput = z.object({
  full_name: name,
  email: email.nullable().optional(),
  phone_e164: phone.nullable().optional(),
  password,
  locale: z.enum(LOCALES).default('ar'),
  role_key: z.enum(ASSIGNABLE_ROLES),
  granted_permissions: grantedPermissions.optional(),
}).refine((v) => Boolean(v.email || v.phone_e164), { message: 'an email or a phone number is required', path: ['email'] });
export type StaffCreateInput = z.input<typeof staffCreateInput>;

export const staffUpdateInput = z.object({
  full_name: name.optional(),
  email: email.nullable().optional(),
  phone_e164: phone.nullable().optional(),
  locale: z.enum(LOCALES).optional(),
  role_key: z.enum(ASSIGNABLE_ROLES).optional(),
  granted_permissions: grantedPermissions.optional(),
  is_active: z.boolean().optional(),
});
export type StaffUpdateInput = z.input<typeof staffUpdateInput>;

export const resetPasswordInput = z.object({ password });
export const changeMyPasswordInput = z.object({ current_password: z.string().min(1).max(PASSWORD_MAX), new_password: password });

export const branchSettingsInput = z.object({
  max_discount_percent: z.number().min(0).max(100).nullable(),
  /** Invoicing: everything defaults to blank / off until the owner's accountant says otherwise. */
  legal_name_ar: z.string().trim().max(200).nullable(),
  legal_name_en: z.string().trim().max(200).nullable(),
  tax_number: z.string().trim().max(100).nullable(),
  vat_enabled: z.boolean(),
  vat_rate_percent: z.number().min(0).max(100),
  invoice_footer_ar: z.string().trim().max(1000).nullable(),
  invoice_footer_en: z.string().trim().max(1000).nullable(),
  /** A deposit required before a job may start printing. 0 (the default) means the rule is off. */
  deposit_percent: z.number().min(0).max(100),
  /** Only orders at or above this total need a deposit. Null means every order does. */
  deposit_threshold: z.number().min(0).nullable(),
  /** Where the owner's end-of-day summary goes. Null (the default) means none is sent. */
  summary_email: z.string().trim().toLowerCase().email().max(254).nullable(),
  /** The local hour (0-23, in the shop's own timezone) it goes out. */
  summary_hour: z.number().int().min(0).max(23),
}).partial();
export type BranchSettingsInput = z.input<typeof branchSettingsInput>;

/** What appears in the audit log, one entry per sensitive action. */
export const AUDIT_ACTIONS = [
  'user.created', 'user.updated', 'user.role_changed', 'user.permissions_changed',
  'user.deactivated', 'user.reactivated', 'user.password_reset', 'user.sessions_ended',
  'branch_settings.updated', 'my_password.changed', 'order.deposit_overridden', 'order.items_edited_after_lock',
  'customer_account.deactivated', 'customer_account.reactivated', 'customer_account.merged',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
