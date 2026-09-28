import { z } from 'zod';
import { extractVariables, findUnknownVariables } from './template';

export const CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];

export const TEMPLATE_KEYS = [
  'order.pending',
  'order.received',
  'order.printing',
  'order.ready',
  'order.out_for_delivery',
  'order.delivered',
  'order.invoice',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/**
 * Whitelist of variables usable as {{name}} in templates.
 * NOTE: `order_id` is the customer-facing order NUMBER (e.g. 1042), not the internal UUID.
 */
export const TEMPLATE_VARIABLES = [
  'customer_name', 'order_id', 'tracking_url', 'total', 'currency', 'branch_name',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const TEMPLATE_VARIABLE_HELP: Record<TemplateVariable, { ar: string; en: string }> = {
  customer_name: { ar: 'اسم العميل', en: 'Customer name' },
  order_id: { ar: 'رقم الطلب', en: 'Order number' },
  tracking_url: { ar: 'رابط تتبع الطلب', en: 'Order tracking link' },
  total: { ar: 'إجمالي الطلب', en: 'Order total' },
  currency: { ar: 'العملة', en: 'Currency' },
  branch_name: { ar: 'اسم الفرع', en: 'Branch name' },
};

export const templateEditInput = z.object({
  body: z.string().trim().min(1).max(1600),
  subject: z.string().trim().max(200).nullable().optional(),
  is_active: z.boolean().optional(),
  /** The name of the template Meta approved; changing it is how a WhatsApp message's wording actually changes. */
  provider_template_name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'lowercase letters, digits and underscores').nullable().optional(),
});
export type TemplateEditInput = z.input<typeof templateEditInput>;

export type TemplateProblem =
  | { code: 'unknown_variables'; names: string[] }
  | { code: 'email_needs_subject' }
  | { code: 'whatsapp_variables_changed'; expected: string[]; got: string[] };

/**
 * What would make a template edit wrong, checked the same way on the device (to explain) and on the server (to refuse).
 * WhatsApp is the subtle one: for a template Meta approved, Meta sends ITS wording and fills its placeholders in the
 * order of our variable list. Changing that list without switching to a newly approved template would put the
 * customer's name where the order number belongs, silently.
 */
export function templateProblems(
  current: { channel: string; variables: readonly string[]; provider_template_name: string | null },
  edit: { body: string; subject?: string | null; provider_template_name?: string | null },
): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const unknown = [...findUnknownVariables(edit.body, TEMPLATE_VARIABLES), ...findUnknownVariables(edit.subject ?? '', TEMPLATE_VARIABLES)];
  if (unknown.length > 0) problems.push({ code: 'unknown_variables', names: [...new Set(unknown)] });
  if (current.channel === 'email' && !edit.subject?.trim()) problems.push({ code: 'email_needs_subject' });

  const approved = edit.provider_template_name === undefined ? current.provider_template_name : edit.provider_template_name;
  const sameApproval = approved !== null && approved === current.provider_template_name;
  const got = extractVariables(edit.body);
  if (current.channel === 'whatsapp' && sameApproval && got.join(',') !== current.variables.join(',')) {
    problems.push({ code: 'whatsapp_variables_changed', expected: [...current.variables], got });
  }
  return problems;
}
