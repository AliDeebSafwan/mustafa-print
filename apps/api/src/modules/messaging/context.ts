import type { Queryable } from '../../db/pool';
import type { Channel, Locale } from './types';

export interface OrderContext {
  order: {
    id: string;
    branchId: string;
    orderNumber: string | null;
    publicCode: string;
    status: string;
    total: string;
    currency: string;
  };
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    locale: Locale;
    whatsappOptIn: boolean;
    smsOptIn: boolean;
    emailOptIn: boolean;
    preferredChannel: Channel;
  };
  branch: { nameAr: string; nameEn: string };
}

interface Row {
  id: string; branch_id: string; order_number: string | null; public_code: string; status: string; total: string; currency: string;
  customer_id: string; full_name: string; phone_e164: string | null; email: string | null; locale: Locale;
  whatsapp_opt_in: boolean; sms_opt_in: boolean; email_opt_in: boolean; preferred_channel: Channel;
  branch_name_ar: string; branch_name_en: string;
}

export async function loadOrderContext(q: Queryable, orderId: string): Promise<OrderContext | null> {
  const { rows } = await q.query<Row>(
    `SELECT o.id, o.branch_id, o.order_number::text, o.public_code, o.status, o.total::text, o.currency,
            c.id AS customer_id, c.full_name, c.phone_e164, c.email, c.locale,
            c.whatsapp_opt_in, c.sms_opt_in, c.email_opt_in, c.preferred_channel,
            b.name_ar AS branch_name_ar, b.name_en AS branch_name_en
       FROM orders o
       JOIN customers c ON c.id = o.customer_id AND c.branch_id = o.branch_id
       JOIN branches  b ON b.id = o.branch_id
      WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [orderId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    order: { id: r.id, branchId: r.branch_id, orderNumber: r.order_number, publicCode: r.public_code, status: r.status, total: r.total, currency: r.currency },
    customer: {
      id: r.customer_id, fullName: r.full_name, phone: r.phone_e164, email: r.email, locale: r.locale,
      whatsappOptIn: r.whatsapp_opt_in, smsOptIn: r.sms_opt_in, emailOptIn: r.email_opt_in, preferredChannel: r.preferred_channel,
    },
    branch: { nameAr: r.branch_name_ar, nameEn: r.branch_name_en },
  };
}

/** Values available to templates. */
export function buildTemplateValues(ctx: OrderContext, publicWebUrl: string, locale: Locale) {
  const base = publicWebUrl.replace(/\/+$/, '');
  return {
    customer_name: ctx.customer.fullName,
    order_id: ctx.order.orderNumber,
    tracking_url: `${base}/${locale}/track/${ctx.order.publicCode}`,
    total: Number(ctx.order.total).toFixed(2),
    currency: ctx.order.currency,
    branch_name: locale === 'ar' ? ctx.branch.nameAr : ctx.branch.nameEn,
  };
}
