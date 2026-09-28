import { DEFAULT_LOCALE, type OrderStatus } from '@mpe/shared';
import type { Queryable } from '../../db/pool';
import { buildTemplateValues, loadOrderContext, type OrderContext } from './context';
import { MissingVariableError, renderTemplate } from './template-engine';
import type { Channel, Locale } from './types';

/** Statuses that automatically notify the customer (the ones named in the product brief). */
export const STATUS_TEMPLATE_KEY: Partial<Record<OrderStatus, string>> = {
  pending: 'order.pending',
  received: 'order.received',
  printing: 'order.printing',
  ready: 'order.ready',
  out_for_delivery: 'order.out_for_delivery',
  delivered: 'order.delivered',
};

/** One channel per event: the customer's preferred one if consented, otherwise the first consented fallback. */
export function pickChannel(c: OrderContext['customer']): { channel: Channel; recipient: string } | null {
  const available: Record<Channel, string | null> = {
    whatsapp: c.whatsappOptIn ? c.phone : null,
    sms: c.smsOptIn ? c.phone : null,
    email: c.emailOptIn ? c.email : null,
  };
  const order: Channel[] = [c.preferredChannel, 'whatsapp', 'sms', 'email'];
  for (const channel of order) {
    const recipient = available[channel];
    if (recipient) return { channel, recipient };
  }
  return null;
}

export interface EnqueueOptions {
  publicWebUrl: string;
  trigger?: 'status_change' | 'invoice' | 'manual' | 'system';
  createdBy?: string | null;
  /** Force a specific template key (e.g. 'order.invoice'); defaults to the key mapped from the status. */
  templateKey?: string;
}
export interface EnqueueResult { queued: boolean; reason?: string; logId?: string }

interface TemplateRow {
  id: string; subject: string | null; body: string; locale: Locale;
}

/**
 * Call inside the SAME transaction that changes the order status: the message row commits together with the
 * status change (transactional outbox), and the worker delivers it afterwards.
 * Idempotent per (order, template, channel) through dedupe_key.
 */
export async function enqueueOrderNotification(q: Queryable, orderId: string, status: OrderStatus, opts: EnqueueOptions): Promise<EnqueueResult> {
  const templateKey = opts.templateKey ?? STATUS_TEMPLATE_KEY[status];
  if (!templateKey) return { queued: false, reason: 'no_template_for_status' };

  const ctx = await loadOrderContext(q, orderId);
  if (!ctx) return { queued: false, reason: 'order_not_found' };

  const pick = pickChannel(ctx.customer);
  if (!pick) return { queued: false, reason: 'no_consented_channel' };

  // Customer's language first, then Arabic as the shop default.
  const wanted: Locale[] = ctx.customer.locale === DEFAULT_LOCALE ? [DEFAULT_LOCALE] : [ctx.customer.locale, DEFAULT_LOCALE];
  let template: TemplateRow | undefined;
  for (const locale of wanted) {
    const { rows } = await q.query<TemplateRow>(
      `SELECT id, subject, body, locale FROM notification_templates
        WHERE branch_id = $1 AND template_key = $2 AND channel = $3 AND locale = $4 AND is_active AND deleted_at IS NULL`,
      [ctx.order.branchId, templateKey, pick.channel, locale],
    );
    if (rows[0]) { template = rows[0]; break; }
  }
  if (!template) return { queued: false, reason: 'template_not_found' };

  const values = buildTemplateValues(ctx, opts.publicWebUrl, template.locale);

  let body: string;
  let subject: string | null = null;
  try {
    body = renderTemplate(template.body, values);
    subject = template.subject ? renderTemplate(template.subject, values) : null;
  } catch (err) {
    if (!(err instanceof MissingVariableError)) throw err;
    // Keep a visible record, but WITHOUT a dedupe key so it can be retried once the data exists.
    const failed = await q.query<{ id: string }>(
      `INSERT INTO notification_logs (branch_id, order_id, customer_id, template_id, template_key, channel, locale, trigger,
                                       recipient, subject, body, variables, status, error_code, error_message, failed_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'failed','TEMPLATE_RENDER',$13, clock_timestamp(), $14)
       RETURNING id`,
      [ctx.order.branchId, ctx.order.id, ctx.customer.id, template.id, templateKey, pick.channel, template.locale, opts.trigger ?? 'status_change',
       pick.recipient, template.subject, template.body, JSON.stringify(values), err.message, opts.createdBy ?? null],
    );
    return { queued: false, reason: 'render_failed', logId: failed.rows[0]?.id };
  }

  const res = await q.query<{ id: string }>(
    `INSERT INTO notification_logs (branch_id, order_id, customer_id, template_id, template_key, channel, locale, trigger,
                                     recipient, subject, body, variables, dedupe_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (branch_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [ctx.order.branchId, ctx.order.id, ctx.customer.id, template.id, templateKey, pick.channel, template.locale, opts.trigger ?? 'status_change',
     pick.recipient, subject, body, JSON.stringify(values), `order:${ctx.order.id}:${templateKey}:${pick.channel}`, opts.createdBy ?? null],
  );
  return res.rows[0] ? { queued: true, logId: res.rows[0].id } : { queued: false, reason: 'duplicate' };
}

/**
 * Staff composing their own message rather than a status update, from the order screen. No template; refused if
 * the customer never consented to that channel — a manual send is not a loophole around the same consent rule the
 * automatic messages already follow. `id` is caller-supplied and the insert is idempotent on it, so a device can
 * queue this offline and safely retry the exact same mutation without ever sending the message twice.
 */
export async function enqueueManualMessage(
  q: Queryable, id: string, orderId: string, opts: { channel: Channel; body: string; createdBy: string | null },
): Promise<EnqueueResult> {
  const ctx = await loadOrderContext(q, orderId);
  if (!ctx) return { queued: false, reason: 'order_not_found' };

  const consent: Record<Channel, boolean> = { whatsapp: ctx.customer.whatsappOptIn, sms: ctx.customer.smsOptIn, email: ctx.customer.emailOptIn };
  const recipient: Record<Channel, string | null> = { whatsapp: ctx.customer.phone, sms: ctx.customer.phone, email: ctx.customer.email };
  if (!consent[opts.channel] || !recipient[opts.channel]) return { queued: false, reason: 'no_consented_channel' };

  const res = await q.query<{ id: string }>(
    `INSERT INTO notification_logs (id, branch_id, order_id, customer_id, channel, locale, trigger, recipient, body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [id, ctx.order.branchId, ctx.order.id, ctx.customer.id, opts.channel, ctx.customer.locale, recipient[opts.channel], opts.body, opts.createdBy],
  );
  return res.rows[0] ? { queued: true, logId: res.rows[0].id } : { queued: false, reason: 'duplicate' };
}
