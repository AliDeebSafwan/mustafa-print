import type { Channel, Locale } from '@mpe/shared';
import { TEMPLATE_KEYS, type TemplateKey } from '@mpe/shared';
import { extractVariables } from './template-engine';

/**
 * Default message copy. Seeded once per branch (never overwritten, so shop edits survive re-seeding).
 * Variables: see TEMPLATE_VARIABLES in @mpe/shared. `order_id` is the customer-facing order number.
 */
const COPY: Record<TemplateKey, Record<Locale, { subject: string; body: string }>> = {
  'order.pending': {
    ar: { subject: 'وصلنا طلبك رقم {{order_id}}', body: 'مرحباً {{customer_name}}، وصلنا طلبك رقم {{order_id}} من الموقع. سنراجعه ونؤكده معك قريباً. التتبع: {{tracking_url}}' },
    en: { subject: 'We got your order #{{order_id}}', body: 'Hello {{customer_name}}, we got your order #{{order_id}} from the website. We will review it and confirm with you shortly. Track it: {{tracking_url}}' },
  },
  'order.received': {
    ar: { subject: 'تم استلام طلبك رقم {{order_id}}', body: 'مرحباً {{customer_name}}، تم استلام طلبك رقم {{order_id}}. يمكنك تتبعه من هنا: {{tracking_url}}' },
    en: { subject: 'We received your order #{{order_id}}', body: 'Hello {{customer_name}}, we received your order #{{order_id}}. Track it here: {{tracking_url}}' },
  },
  'order.printing': {
    ar: { subject: 'طلبك رقم {{order_id}} قيد الطباعة', body: 'مرحباً {{customer_name}}، طلبك رقم {{order_id}} قيد الطباعة الآن. التتبع: {{tracking_url}}' },
    en: { subject: 'Your order #{{order_id}} is being printed', body: 'Hello {{customer_name}}, your order #{{order_id}} is printing now. Track it: {{tracking_url}}' },
  },
  'order.ready': {
    ar: { subject: 'طلبك رقم {{order_id}} جاهز', body: 'مرحباً {{customer_name}}، طلبك رقم {{order_id}} أصبح جاهزاً للاستلام من {{branch_name}}. قيمة الطلب: {{total}} {{currency}}.' },
    en: { subject: 'Your order #{{order_id}} is ready', body: 'Hello {{customer_name}}, your order #{{order_id}} is ready at {{branch_name}}. Order total: {{total}} {{currency}}.' },
  },
  'order.out_for_delivery': {
    ar: { subject: 'طلبك رقم {{order_id}} في الطريق إليك', body: 'مرحباً {{customer_name}}، طلبك رقم {{order_id}} خرج للتوصيل وسيصلك قريباً.' },
    en: { subject: 'Your order #{{order_id}} is on its way', body: 'Hello {{customer_name}}, your order #{{order_id}} is out for delivery and will arrive soon.' },
  },
  'order.delivered': {
    ar: { subject: 'تم تسليم طلبك رقم {{order_id}}', body: 'شكراً {{customer_name}}! تم تسليم طلبك رقم {{order_id}}. نسعد بخدمتك دائماً في {{branch_name}}.' },
    en: { subject: 'Your order #{{order_id}} was delivered', body: 'Thank you {{customer_name}}! Your order #{{order_id}} was delivered. We are always happy to serve you at {{branch_name}}.' },
  },
  'order.invoice': {
    ar: { subject: 'فاتورة طلبك رقم {{order_id}}', body: 'مرحباً {{customer_name}}، فاتورة طلبك رقم {{order_id}} بقيمة {{total}} {{currency}}. التتبع والفاتورة: {{tracking_url}}' },
    en: { subject: 'Invoice for your order #{{order_id}}', body: 'Hello {{customer_name}}, the invoice for your order #{{order_id}} is {{total}} {{currency}}. Tracking and invoice: {{tracking_url}}' },
  },
};

export interface DefaultTemplate {
  key: TemplateKey;
  channel: Channel;
  locale: Locale;
  subject: string | null;
  body: string;
  variables: string[];
  providerTemplateName: string | null;
  providerTemplateLanguage: string | null;
}

export function buildDefaultTemplates(): DefaultTemplate[] {
  const out: DefaultTemplate[] = [];
  for (const key of TEMPLATE_KEYS) {
    for (const locale of ['ar', 'en'] as const) {
      const { subject, body } = COPY[key][locale];
      for (const channel of ['whatsapp', 'sms', 'email'] as const) {
        out.push({
          key, channel, locale, body,
          subject: channel === 'email' ? subject : null,
          variables: extractVariables(body),
          // Names to create in Meta Business Manager (see `pnpm --filter @mpe/api wa:templates`).
          providerTemplateName: channel === 'whatsapp' ? `mpe_${key.replace('.', '_')}` : null,
          providerTemplateLanguage: channel === 'whatsapp' ? locale : null,
        });
      }
    }
  }
  return out;
}

/**
 * Adds every default message the branch does not have yet, never touching ones that exist (the owner may have edited
 * them). Runs on every deployment, so a message introduced in a later version reaches shops that are already running.
 */
export async function ensureDefaultTemplates(q: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }> }): Promise<number> {
  let inserted = 0;
  for (const t of buildDefaultTemplates()) {
    const res = await q.query(
      `INSERT INTO notification_templates (branch_id, template_key, channel, locale, subject, body, variables,
                                           provider_template_name, provider_template_language, is_system)
       SELECT b.id, $1, $2, $3, $4, $5, $6, $7, $8, true FROM branches b WHERE b.deleted_at IS NULL
       ON CONFLICT (branch_id, template_key, channel, locale) WHERE deleted_at IS NULL DO NOTHING`,
      [t.key, t.channel, t.locale, t.subject, t.body, t.variables, t.providerTemplateName, t.providerTemplateLanguage]);
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}
