/**
 * Exact money arithmetic for the staff app's previews. It reproduces what the database does (numeric columns,
 * round half away from zero) so the total a cashier sees is the total the server stores.
 *
 * Values are held as scaled integers in plain numbers (no BigInt: the app must run on old tablet browsers).
 * quantity: 3 decimals, unit price: 4 decimals, money: 2 decimals. A product that does not fit in 53 bits is rejected.
 */
export type DecimalInput = string | number;

const DIGITS = /^(\d+)(?:\.(\d*))?$/;

/** "12.345" -> 1235 at 2 decimals. Extra digits round half up (values here are never negative). null if not a plain non-negative decimal. */
function scale(value: DecimalInput, decimals: number): number | null {
  const text = (typeof value === 'number' ? String(value) : value).trim();
  const match = DIGITS.exec(text);
  if (!match) return null;
  const whole = match[1]!;
  const fraction = (match[2] ?? '').padEnd(decimals + 1, '0');
  const kept = Number(`${whole}${fraction.slice(0, decimals)}`);
  const roundUp = fraction.charCodeAt(decimals) >= 53 ? 1 : 0;      // next digit >= 5
  const result = kept + roundUp;
  return Number.isSafeInteger(result) ? result : null;
}

/** Integer division rounding half up, exact for safe integers (a plain n / d can be off by one near the boundary). */
function divRound(n: number, d: number): number {
  let quotient = Math.floor(n / d);
  let remainder = n - quotient * d;
  if (remainder < 0) { quotient -= 1; remainder += d; }
  if (remainder >= d) { quotient += 1; remainder -= d; }
  return remainder * 2 >= d ? quotient + 1 : quotient;
}

export const toCents = (value: DecimalInput): number | null => scale(value, 2);

/** 1234 -> "12.34" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export interface LineInput { quantity: DecimalInput; unitPrice: DecimalInput; discount?: DecimalInput }

export type TotalsError = 'invalid_amount' | 'amount_too_large' | 'negative_line' | 'negative_total';
export type OrderTotals =
  | { ok: true; lines: string[]; subtotal: string; discountTotal: string; deliveryFee: string; total: string }
  | { ok: false; error: TotalsError; line?: number };

/**
 * line_total = round(round(quantity, 3) * round(unit_price, 4), 2) - discount
 * total      = sum(line_total) - discount_total + delivery_fee
 * Same rules as the server's order insert.
 */
export function computeOrderTotals(input: { lines: LineInput[]; discountTotal?: DecimalInput; deliveryFee?: DecimalInput }): OrderTotals {
  let subtotal = 0;
  const lines: string[] = [];
  for (const [index, line] of input.lines.entries()) {
    const quantity = scale(line.quantity, 3);
    const price = scale(line.unitPrice, 4);
    const discount = scale(line.discount ?? 0, 2);
    if (quantity === null || price === null || discount === null) return { ok: false, error: 'invalid_amount', line: index };
    const product = quantity * price;                                   // scaled by 10^7
    if (!Number.isSafeInteger(product)) return { ok: false, error: 'amount_too_large', line: index };
    const lineTotal = divRound(product, 10 ** 5) - discount;             // -> cents
    if (lineTotal < 0) return { ok: false, error: 'negative_line', line: index };
    lines.push(formatCents(lineTotal));
    subtotal += lineTotal;
  }
  const discountTotal = scale(input.discountTotal ?? 0, 2);
  const deliveryFee = scale(input.deliveryFee ?? 0, 2);
  if (discountTotal === null || deliveryFee === null) return { ok: false, error: 'invalid_amount' };
  const total = subtotal - discountTotal + deliveryFee;
  if (!Number.isSafeInteger(total)) return { ok: false, error: 'amount_too_large' };
  if (total < 0) return { ok: false, error: 'negative_total' };
  return { ok: true, lines, subtotal: formatCents(subtotal), discountTotal: formatCents(discountTotal), deliveryFee: formatCents(deliveryFee), total: formatCents(total) };
}

export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentSummary { paid: string; refunded: string; net: string; status: PaymentStatus }

/**
 * Same rules as the database trigger that maintains orders.paid_total / payment_status
 * (only completed transactions count).
 */
export function summarizePayments(total: DecimalInput, transactions: { txn_type: string; amount: DecimalInput }[]): PaymentSummary {
  let paid = 0;
  let refunded = 0;
  for (const t of transactions) {
    const cents = toCents(t.amount) ?? 0;
    if (t.txn_type === 'payment') paid += cents;
    else if (t.txn_type === 'refund') refunded += cents;
  }
  const totalCents = toCents(total) ?? 0;
  const net = paid - refunded;
  const status: PaymentStatus =
    paid > 0 && net <= 0 ? 'refunded' : totalCents > 0 && net >= totalCents ? 'paid' : net > 0 ? 'partial' : 'unpaid';
  return { paid: formatCents(paid), refunded: formatCents(refunded), net: formatCents(net), status };
}

/**
 * Whether a discount needs a manager. `subtotal` is the order before any order-level discount; `discount` is the
 * order-level discount plus everything taken off the individual lines. A null cap means the shop set no limit.
 *
 * The same function runs on the device (to warn before the order is taken) and on the server (to refuse it),
 * so the two can never disagree about where the line is.
 */
export function discountExceedsCap(subtotal: DecimalInput, discount: DecimalInput, maxPercent: number | null): boolean {
  if (maxPercent === null) return false;
  const subtotalCents = toCents(subtotal) ?? 0;
  const discountCents = toCents(discount) ?? 0;
  if (discountCents <= 0) return false;
  if (subtotalCents <= 0) return true;                       // any money off nothing is always a manager's call
  // Compare in integers: discount/subtotal > maxPercent/100
  return discountCents * 10_000 > subtotalCents * Math.round(maxPercent * 100);
}

export interface PriceTier { min_quantity: DecimalInput; unit_price: DecimalInput }
export interface PricedProduct { pricing_model?: string | null; base_price: DecimalInput; price_rules?: PriceTier[] | null; min_quantity?: DecimalInput | null }

/**
 * What one unit costs at this quantity: the tier with the largest `min_quantity` the order reaches, or the base price.
 * A fixed-price product ignores quantity entirely. Returns a decimal string, never a float.
 */
export function unitPriceFor(product: PricedProduct, quantity: DecimalInput): string {
  const base = toCents4(product.base_price);
  if (product.pricing_model !== 'tiered' || !product.price_rules?.length) return base;
  const wanted = Number(quantity);
  const reached = product.price_rules
    .filter((tier) => Number(tier.min_quantity) <= wanted)
    .sort((a, b) => Number(a.min_quantity) - Number(b.min_quantity))
    .at(-1);
  return reached ? toCents4(reached.unit_price) : base;
}

/** A price as the database stores it: up to 4 decimal places, no float artefacts. */
function toCents4(value: DecimalInput): string {
  const text = (typeof value === 'number' ? String(value) : value).trim();
  return /^\d+(\.\d{1,4})?$/.test(text) ? text : '0';
}
