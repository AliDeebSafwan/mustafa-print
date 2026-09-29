import { z } from 'zod';
import { LOCALES } from '../util/locales';
import { CHANNELS } from './notifications';
import { ORDER_STATUSES } from '../rules/order-status';
import { PUBLIC_CODE_RE } from '../util/ids';

/**
 * Payload contracts for offline mutations. The staff app builds payloads against these types and the API validates
 * with the very same schemas, so client and server cannot drift apart silently.
 */

const DECIMAL = /^\d+(\.\d{1,4})?$/;
const SIGNED_DECIMAL = /^-?\d+(\.\d{1,4})?$/;

/** A money/quantity value that survives JSON: "12.50" or 12.5 in, decimal string out. Never floats in the database. */
const decimalOf = (pattern: RegExp) =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    const text = typeof value === 'number' ? String(value) : value.trim();
    if (!pattern.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'invalid decimal number (max 4 decimal places)' });
      return z.NEVER;
    }
    return text;
  });
export const decimal = decimalOf(DECIMAL);
export const signedDecimal = decimalOf(SIGNED_DECIMAL);

const isPositive = (v: string) => Number(v) > 0;
const isNonZero = (v: string) => Number(v) !== 0;

const text = (max = 500) => z.string().trim().max(max);
const optionalText = (max = 500) => text(max).nullable().optional();
const uuid = z.string().uuid();
const timestamp = z.iso.datetime({ offset: true });

/** Field-level optimistic concurrency: `changes` are the new values, `base` the values the user saw when editing. */
export const patchOf = <S extends z.ZodObject>(fields: S) =>
  z.object({
    changes: fields.partial().refine((c) => Object.keys(c).length > 0, 'no changes'),
    base: z.record(z.string(), z.unknown()),
  });

// ---- customers ------------------------------------------------------------------------------------------------
const CONSENT_SOURCES = ['checkout', 'in_person', 'phone', 'migration'] as const;

export const customerFields = z.object({
  full_name: text(200).min(1),
  customer_type: z.enum(['b2c', 'b2b']),
  company_name: optionalText(200),
  phone_e164: z.string().regex(/^\+[1-9][0-9]{6,14}$/).nullable(),
  email: z.string().email().max(254).nullable(),
  address_line: optionalText(300),
  city: optionalText(100),
  country_code: z.string().length(2).transform((c) => c.toUpperCase()).nullable(),
  locale: z.enum(LOCALES),
  whatsapp_opt_in: z.boolean(),
  sms_opt_in: z.boolean(),
  email_opt_in: z.boolean(),
  preferred_channel: z.enum(CHANNELS),
  consent_source: z.enum(CONSENT_SOURCES).nullable(),
  notes: optionalText(2000),
  /** For a company's invoice. Free text: formats vary too much across countries to validate here. */
  tax_number: optionalText(100),
  /** Highest total this customer may owe across unpaid orders before a new one needs orders:credit:override. Null: no limit. */
  credit_limit: decimal.nullable(),
});

const hasOptIn = (c: { whatsapp_opt_in?: boolean; sms_opt_in?: boolean; email_opt_in?: boolean }) =>
  Boolean(c.whatsapp_opt_in || c.sms_opt_in || c.email_opt_in);
const CONSENT_MESSAGE = 'consent_source is required when a messaging opt-in is set';

export const customerInsertPayload = customerFields
  .partial()
  .required({ full_name: true })
  .refine((c) => Boolean(c.phone_e164 || c.email), 'phone_e164 or email is required')
  .refine((c) => !hasOptIn(c) || Boolean(c.consent_source), CONSENT_MESSAGE);

export const customerUpdatePayload = patchOf(customerFields).refine(
  (p) => !hasOptIn(p.changes) || Boolean(p.changes.consent_source), CONSENT_MESSAGE);

// ---- orders ---------------------------------------------------------------------------------------------------
export const orderItemInput = z.object({
  id: uuid,
  product_id: uuid.nullable().optional(),
  name_snapshot: text(300).min(1),
  unit: text(20).min(1).optional(),
  quantity: decimal.refine(isPositive, 'quantity must be greater than 0'),
  unit_price: decimal,
  discount: decimal.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  notes: optionalText(1000),
  sort_order: z.number().int().min(0).optional(),
});

export const orderInsertPayload = z.object({
  public_code: z.string().regex(PUBLIC_CODE_RE),
  customer_id: uuid,
  fulfillment_type: z.enum(['pickup', 'delivery']).optional(),
  delivery_address: optionalText(500),
  delivery_city: optionalText(100),
  delivery_notes: optionalText(1000),
  payment_method: z.enum(['cash', 'cod', 'whish_money']).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  discount_total: decimal.optional(),
  delivery_fee: decimal.optional(),
  customer_notes: optionalText(2000),
  internal_notes: optionalText(2000),
  due_at: timestamp.nullable().optional(),
  items: z.array(orderItemInput).min(1).max(100),
});

/** Only non-financial fields can be patched; status and money have dedicated, validated paths. */
export const orderPatchFields = z.object({
  customer_notes: optionalText(2000),
  internal_notes: optionalText(2000),
  delivery_address: optionalText(500),
  delivery_city: optionalText(100),
  delivery_notes: optionalText(1000),
  due_at: timestamp.nullable(),
  fulfillment_type: z.enum(['pickup', 'delivery']),
  payment_method: z.enum(['cash', 'cod', 'whish_money']),
});
export const orderUpdatePayload = patchOf(orderPatchFields);

export const statusChangePayload = z
  .object({
    order_id: uuid,
    from_status: z.enum(ORDER_STATUSES).nullable().optional(),   // what the device saw; informational
    to_status: z.enum(ORDER_STATUSES),
    source: z.enum(['manual', 'scanner']),
    barcode_code: optionalText(64),
    note: optionalText(1000),
    occurred_at: timestamp,
  })
  // A cancellation must say why: it is what the shop reads months later when a customer asks what happened.
  // The rule lives here so the staff app refuses it before queueing AND the server refuses it however it arrives.
  .refine((p) => p.to_status !== 'cancelled' || Boolean(p.note), 'cancelling requires a reason (note)');

/**
 * Replaces an order's whole item list, and optionally its discount. Blocked once the order has started production,
 * been paid at all, or had its invoice issued — unless the actor holds orders:items:override, in which case a
 * reason is required (checked again here: `refine` covers what the shared type can see, but whether an override is
 * actually NEEDED depends on the order's current state, which only the server knows at the moment of the edit).
 */
export const orderItemsEditPayload = z.object({
  items: z.array(orderItemInput).min(1).max(100),
  discount_total: decimal.optional(),
  override_reason: optionalText(500),
});

// ---- B2B: a company's own agreed price for a product --------------------------------------------------------------
export const priceOverrideInsertPayload = z.object({ customer_id: uuid, product_id: uuid, unit_price: decimal });
export const priceOverrideUpdatePayload = z.object({ unit_price: decimal, base: z.record(z.string(), z.unknown()) });
export const priceOverrideDeletePayload = z.object({});

// ---- products ---------------------------------------------------------------------------------------------------
export const PRODUCT_UNITS = ['piece', 'sheet', 'sqm', 'meter', 'set', 'hour'] as const;
export const PRICING_MODELS = ['fixed', 'per_unit', 'tiered'] as const;      // per_area and quote come with the pricing engine

/** "500 or more cost 0.04 each". Tiers are sorted and applied by the largest min_quantity that fits. */
export const priceTier = z.object({
  min_quantity: decimal.refine(isPositive, 'min_quantity must be greater than 0'),
  unit_price: decimal,
});

export const productFields = z.object({
  sku: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash and underscore only'),
  name_ar: text(200).min(1),
  name_en: text(200).min(1),
  description_ar: optionalText(2000),
  description_en: optionalText(2000),
  category: text(60).min(1),
  unit: z.enum(PRODUCT_UNITS),
  pricing_model: z.enum(PRICING_MODELS),
  base_price: decimal,
  min_quantity: decimal.refine(isPositive, 'min_quantity must be greater than 0'),
  price_rules: z.array(priceTier).max(20),
  is_active: z.boolean(),
  /** Shown on the customer website. */
  is_public: z.boolean(),
  /** Its picture on the website; must be described before the product can be shown. */
  cover_media_id: uuid.nullable(),
  /** Which service page this product is orderable from, if any. */
  service_id: uuid.nullable(),
  sort_order: z.number().int().min(0).max(9999),
});

export const productInsertPayload = productFields.partial().required({ sku: true, name_ar: true, name_en: true });
export const productUpdatePayload = patchOf(productFields);

// ---- the store: what is kept, and what each product eats ---------------------------------------------------------
export const INVENTORY_CATEGORIES = ['paper', 'ink', 'plate', 'film', 'packaging', 'chemical', 'spare_part', 'other'] as const;
export const INVENTORY_UNITS = ['sheet', 'ream', 'ml', 'liter', 'g', 'kg', 'piece', 'meter', 'roll', 'box'] as const;

export const inventoryItemFields = z.object({
  sku: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash and underscore only'),
  name_ar: text(200).min(1),
  name_en: text(200).min(1),
  category: z.enum(INVENTORY_CATEGORIES),
  unit: z.enum(INVENTORY_UNITS),
  reorder_level: decimal,
  reorder_quantity: decimal.refine(isPositive, 'reorder_quantity must be greater than 0').nullable().optional(),
  cost_per_unit: decimal.nullable().optional(),
  supplier_name: optionalText(200),
  is_active: z.boolean(),
});
// quantity_on_hand is deliberately absent: the balance is the ledger's to decide, never a field someone types.
export const inventoryItemInsertPayload = inventoryItemFields.partial().required({ sku: true, name_ar: true, name_en: true, category: true, unit: true });
export const inventoryItemUpdatePayload = patchOf(inventoryItemFields);

/** One line of a product's recipe: how much of an item ONE unit of the product eats, plus expected waste. */
export const productMaterialFields = z.object({
  product_id: uuid,
  item_id: uuid,
  quantity_per_unit: decimal.refine(isPositive, 'quantity_per_unit must be greater than 0'),
  waste_pct: decimal,
  notes: optionalText(500),
});
export const productMaterialInsertPayload = productMaterialFields.partial().required({ product_id: true, item_id: true, quantity_per_unit: true });
export const productMaterialUpdatePayload = patchOf(productMaterialFields.omit({ product_id: true, item_id: true }));
export const productMaterialDeletePayload = z.object({});

// ---- inventory & money ----------------------------------------------------------------------------------------
export const STOCK_MOVEMENT_TYPES = ['consumption', 'waste', 'receipt', 'return', 'adjustment', 'opening_balance'] as const;

export const stockMovementPayload = z.object({
  item_id: uuid,
  movement_type: z.enum(STOCK_MOVEMENT_TYPES),
  quantity_delta: signedDecimal.refine(isNonZero, 'quantity_delta cannot be 0'),   // consumption/waste negative, receipt positive
  unit_cost: decimal.nullable().optional(),
  order_id: uuid.nullable().optional(),
  order_item_id: uuid.nullable().optional(),
  reason: optionalText(500),
  occurred_at: timestamp,
});

export const transactionInsertPayload = z.object({
  order_id: uuid,
  txn_type: z.enum(['payment', 'refund']),
  method: z.enum(['cash', 'cod']),                      // online wallets are recorded by the server from provider webhooks
  amount: decimal.refine(isPositive, 'amount must be greater than 0'),
  note: optionalText(500),
  collected_at: timestamp.nullable().optional(),
});

/**
 * Handing COD cash over to the shop, one transaction at a time: settling ten collections is ten mutations,
 * so a partial hand-over is recorded exactly as it happened and a repeat never double-counts.
 */
export const transactionSettlePayload = z.object({
  settled_at: timestamp,
});

// ---- registry -------------------------------------------------------------------------------------------------
export const manualMessagePayload = z.object({
  order_id: uuid,
  channel: z.enum(['whatsapp', 'sms', 'email']),
  body: z.string().trim().min(1).max(2000),
});

export const MUTATION_PAYLOADS = {
  'customers:insert': customerInsertPayload,
  'customers:update': customerUpdatePayload,
  'products:insert': productInsertPayload,
  'products:update': productUpdatePayload,
  'orders:insert': orderInsertPayload,
  'orders:update': orderUpdatePayload,
  'orders:edit_items': orderItemsEditPayload,
  'order_status_history:status_change': statusChangePayload,
  'inventory_items:insert': inventoryItemInsertPayload,
  'inventory_items:update': inventoryItemUpdatePayload,
  'product_materials:insert': productMaterialInsertPayload,
  'product_materials:update': productMaterialUpdatePayload,
  'product_materials:delete': productMaterialDeletePayload,
  'stock_movements:stock_movement': stockMovementPayload,
  'transactions:insert': transactionInsertPayload,
  'transactions:settle': transactionSettlePayload,
  'notification_logs:manual_send': manualMessagePayload,
  'company_price_overrides:insert': priceOverrideInsertPayload,
  'company_price_overrides:update': priceOverrideUpdatePayload,
  'company_price_overrides:delete': priceOverrideDeletePayload,
} as const;

export type MutationKind = keyof typeof MUTATION_PAYLOADS;
export const isMutationKind = (v: string): v is MutationKind => v in MUTATION_PAYLOADS;
/** What a client SENDS (before parsing/normalising). */
export type MutationInput<K extends MutationKind> = z.input<(typeof MUTATION_PAYLOADS)[K]>;
/** What the server works with after validation. */
export type MutationParsed<K extends MutationKind> = z.output<(typeof MUTATION_PAYLOADS)[K]>;
