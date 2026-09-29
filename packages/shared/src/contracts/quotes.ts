import { z } from 'zod';
import { decimal } from './mutations';

/**
 * A quote the staff app sends to the server (online, like invoices). Prices come from the person writing the quote —
 * a quote is exactly where a shop sets a custom price — and the server computes every total from them.
 */
export const quoteLineInput = z.object({
  product_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(300),
  unit: z.string().trim().min(1).max(20).optional(),
  quantity: decimal.refine((v) => Number(v) > 0, 'quantity must be greater than 0'),
  unit_price: decimal,
  discount: decimal.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const quoteInput = z.object({
  customer_id: z.string().uuid(),
  items: z.array(quoteLineInput).min(1).max(100),
  discount_total: decimal.optional(),
  /** How many days the customer has to accept. */
  valid_days: z.number().int().min(1).max(90).default(14),
  notes: z.string().trim().max(2000).optional(),
  internal_notes: z.string().trim().max(2000).optional(),
});
export type QuoteInput = z.input<typeof quoteInput>;

export const QUOTE_STATUSES = ['sent', 'accepted', 'declined', 'cancelled'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** What the customer's link shows: the offer, never staff-only notes or anyone else's data. */
export interface PublicQuote {
  number: string;
  status: QuoteStatus | 'expired';
  customerName: string;
  shopNameAr: string;
  shopNameEn: string;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  validUntil: string;
  notes: string | null;
  items: { name: string; quantity: string; unitPrice: string; lineTotal: string }[];
  /** The order this became, once accepted: its tracking code. */
  orderCode: string | null;
}
