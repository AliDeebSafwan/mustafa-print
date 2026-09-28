import { z } from 'zod';
import { LOCALES } from './locales';

/**
 * Customers sign in on the website with an email and a password (the owner's choice). The rules below are shared by
 * the website forms and the API, so what a form accepts is exactly what the server accepts.
 *
 * Passwords follow current guidance: a minimum length and nothing else (no forced symbols), and a cap to keep
 * hashing cheap. Length matters; composition rules mostly produce "Password1!".
 */
import { PASSWORD_MIN } from './limits';
export { PASSWORD_MIN };
export const PASSWORD_MAX = 200;

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const customerSignupInput = z.object({
  email,
  password,
  full_name: z.string().trim().min(1).max(200),
  phone_e164: z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/).nullable().optional(),
  locale: z.enum(LOCALES).default('ar'),
});
export type CustomerSignupInput = z.input<typeof customerSignupInput>;

export const customerLoginInput = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) });
export const customerEmailInput = z.object({ email });
export const customerTokenInput = z.object({ token: z.string().min(20).max(200) });
export const customerResetInput = z.object({ token: z.string().min(20).max(200), password });

export interface CustomerMe { email: string; fullName: string; phone: string | null; locale: 'ar' | 'en'; verified: boolean }
export interface CustomerOrderSummary {
  code: string; number: string | null; status: string; total: string; currency: string; paymentStatus: string; placedAt: string;
}
/** One line from a past order, re-checked against the catalogue right now: a product can vanish or go private
 *  between then and today, so `available` says whether it can actually be added to a new order. */
export interface ReorderItem { productId: string; name: string; quantity: string; available: boolean }

/** What the website sends to place an order. Prices are NOT here: the server computes them from the catalogue. */
export const webOrderInput = z.object({
  /** Made by the browser once per checkout, so a double click or a retry creates one order, not two. */
  request_id: z.string().uuid(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d{1,3})?$/.test(v) && Number(v) > 0 && Number(v) <= 1_000_000, 'a positive quantity'),
    notes: z.string().trim().max(1000).optional(),
    /** Design files uploaded during checkout, for this line. */
    file_ids: z.array(z.string().uuid()).max(10).optional(),
  })).min(1).max(20),
  fulfillment_type: z.enum(['pickup', 'delivery']),
  delivery_address: z.string().trim().max(500).optional(),
  delivery_city: z.string().trim().max(100).optional(),
  delivery_notes: z.string().trim().max(1000).optional(),
  /** Paid when the order is collected (cash) or delivered (cod). Online payment comes with Whish. */
  payment_method: z.enum(['cash', 'cod']),
  customer_notes: z.string().trim().max(2000).optional(),
}).refine((o) => o.fulfillment_type !== 'delivery' || Boolean(o.delivery_address && o.delivery_city), {
  message: 'delivery needs an address and a city', path: ['delivery_address'],
});
export type WebOrderInput = z.input<typeof webOrderInput>;

export interface WebOrderPlaced { code: string; number: string | null; total: string; currency: string; deliveryFeePending: boolean }

export const DESIGN_FILE_LIMIT_BYTES = 100 * 1024 * 1024;
export const DESIGN_FILE_KINDS = ['pdf', 'jpg', 'png', 'tiff', 'psd', 'zip'] as const;
