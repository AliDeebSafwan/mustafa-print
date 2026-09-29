import { describe, expect, it } from 'vitest';
import { allowedNextStatuses, computeOrderTotals, discountExceedsCap, unitPriceFor, formatCents, normalizePhone, roleDefinition, summarizePayments, toCents, toWesternDigits, whyCannotSetStatus } from '../index';

const totals = (over: Parameters<typeof computeOrderTotals>[0]) => computeOrderTotals(over);

describe('computeOrderTotals', () => {
  it('computes lines, subtotal and total exactly (no floating point drift)', () => {
    expect(totals({ lines: [{ quantity: 3, unitPrice: '10.10', discount: '0.30' }, { quantity: 2, unitPrice: 4.5 }], discountTotal: 1, deliveryFee: '2.5' }))
      .toEqual({ ok: true, lines: ['30.00', '9.00'], subtotal: '39.00', discountTotal: '1.00', deliveryFee: '2.50', total: '40.50' });
    expect(totals({ lines: [{ quantity: '0.1', unitPrice: '0.2' }] })).toMatchObject({ ok: true, lines: ['0.02'] });     // 0.1 * 0.2 !== 0.02 in floats
    expect(totals({ lines: [{ quantity: 3, unitPrice: '19.99' }] })).toMatchObject({ lines: ['59.97'] });
  });

  it('rounds half up like the database: quantity to 3 decimals, price to 4, the line to cents', () => {
    expect(totals({ lines: [{ quantity: 1, unitPrice: '0.005' }] })).toMatchObject({ lines: ['0.01'] });
    expect(totals({ lines: [{ quantity: 1, unitPrice: '0.0049' }] })).toMatchObject({ lines: ['0.00'] });
    expect(totals({ lines: [{ quantity: '1.0005', unitPrice: '1000' }] })).toMatchObject({ lines: ['1001.00'] });          // 1.0005 -> 1.001
    expect(totals({ lines: [{ quantity: 1, unitPrice: '1.23455' }] })).toMatchObject({ lines: ['1.23'] });                 // 1.23455 -> 1.2346 -> 1.23
    expect(totals({ lines: [{ quantity: 10_000, unitPrice: '0.0525' }] })).toMatchObject({ lines: ['525.00'] });
  });

  it('accepts an empty order as zero and rejects malformed or impossible amounts', () => {
    expect(totals({ lines: [] })).toMatchObject({ ok: true, total: '0.00' });
    for (const bad of ['', 'abc', '-1', '1e3', '1,5', ' ', '.', '1.2.3']) {
      expect(totals({ lines: [{ quantity: 1, unitPrice: bad }] }), JSON.stringify(bad)).toEqual({ ok: false, error: 'invalid_amount', line: 0 });
    }
    expect(totals({ lines: [{ quantity: 1, unitPrice: 5 }, { quantity: 1, unitPrice: 5, discount: '9' }] })).toEqual({ ok: false, error: 'negative_line', line: 1 });
    expect(totals({ lines: [{ quantity: 1, unitPrice: 5 }], discountTotal: 6 })).toEqual({ ok: false, error: 'negative_total' });
    expect(totals({ lines: [{ quantity: '99999999999', unitPrice: '99999999999' }] })).toMatchObject({ ok: false, error: 'amount_too_large' });
  });

  it('formats cents without float artefacts', () => {
    expect([0, 5, 100, 12345, -250].map(formatCents)).toEqual(['0.00', '0.05', '1.00', '123.45', '-2.50']);
    expect(toCents('12.345')).toBe(1235);
    expect(toCents('x')).toBeNull();
  });
});

describe('summarizePayments (mirrors the database trigger)', () => {
  const tx = (txn_type: string, amount: string | number) => ({ txn_type, amount });
  const status = (total: string, ...t: ReturnType<typeof tx>[]) => summarizePayments(total, t).status;

  it('derives the payment status from completed payments and refunds', () => {
    expect(status('40.00')).toBe('unpaid');
    expect(status('40.00', tx('payment', 15.5))).toBe('partial');
    expect(status('40.00', tx('payment', 15.5), tx('payment', '24.50'))).toBe('paid');
    expect(status('40.00', tx('payment', 50))).toBe('paid');                                   // overpayment still "paid"
    expect(status('40.00', tx('payment', 40), tx('refund', 10))).toBe('partial');
    expect(status('40.00', tx('payment', 40), tx('refund', 40))).toBe('refunded');
    expect(status('0.00', tx('payment', 5))).toBe('partial');                                  // free order: same as the SQL CASE
  });

  it('reports the amounts', () => {
    expect(summarizePayments('40', [tx('payment', 30), tx('refund', 5)])).toEqual({ paid: '30.00', refunded: '5.00', net: '25.00', status: 'partial' });
  });
});

describe('normalizePhone', () => {
  it.each([
    ['03 123 456', '+9613123456'],
    ['70123456', '+96170123456'],
    ['070 123 456', '+96170123456'],
    ['+961 70 123 456', '+96170123456'],
    ['0096170123456', '+96170123456'],
    ['96170123456', '+96170123456'],
    ['(70) 123-456', '+96170123456'],
    ['٠٣ ١٢٣ ٤٥٦', '+9613123456'],
    ['+33 6 12 34 56 78', '+33612345678'],
  ])('%s -> %s', (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it('rejects what cannot be a phone number and honours another default country', () => {
    for (const bad of ['', '   ', 'abc', '12', '+', '+0123456789', '1234567890123456789']) expect(normalizePhone(bad), bad).toBeNull();
    expect(normalizePhone('0501234567', '971')).toBe('+971501234567');
    expect(toWesternDigits('٠١٢٣٤٥٦٧٨٩۰۱۲')).toBe('0123456789012');
  });
});

describe('who may set which status', () => {
  const role = (key: string) => roleDefinition(key)!;

  it('gives one answer for the UI and the server', () => {
    expect(whyCannotSetStatus(role('admin'), 'cancelled')).toBeNull();
    expect(whyCannotSetStatus(role('receptionist'), 'cancelled')).toMatch(/orders:cancel/);
    expect(whyCannotSetStatus(role('machine_operator'), 'delivered')).toMatch(/may not set status/);
    expect(whyCannotSetStatus(role('warehouse_manager'), 'printing')).toMatch(/orders:status:update|may not set/);
    expect(whyCannotSetStatus(role('staff'), 'delivered')).toBeNull();
  });

  it('offers only legal, permitted next steps', () => {
    expect(allowedNextStatuses(role('machine_operator'), 'received')).toEqual(['printing']);
    expect(allowedNextStatuses(role('warehouse_manager'), 'ready')).toEqual([]);   // statusScope: [] — may not move an order into anything
    expect(allowedNextStatuses(role('staff'), 'out_for_delivery')).toEqual(['delivered', 'ready']);   // a failed delivery attempt goes back to ready
    expect(allowedNextStatuses(role('receptionist'), 'received')).not.toContain('cancelled');
    expect(allowedNextStatuses(role('admin'), 'received')).toContain('cancelled');
    expect(allowedNextStatuses(role('admin'), 'delivered')).toEqual([]);
  });
});

describe('how much staff may discount', () => {
  it('allows anything when the shop has set no limit', () => {
    expect(discountExceedsCap('100.00', '100.00', null)).toBe(false);
  });

  it('compares against the subtotal exactly at the boundary', () => {
    expect(discountExceedsCap('100.00', '10.00', 10)).toBe(false);      // exactly 10% is allowed
    expect(discountExceedsCap('100.00', '10.01', 10)).toBe(true);
    expect(discountExceedsCap('33.33', '1.67', 5)).toBe(true);          // 5.01%
    expect(discountExceedsCap('33.33', '1.66', 5)).toBe(false);         // 4.98%
    expect(discountExceedsCap('100.00', '7.50', 7.5)).toBe(false);      // fractional caps work
    expect(discountExceedsCap('100.00', '7.51', 7.5)).toBe(true);
  });

  it('never blocks an order with no discount, and always asks a manager about money off nothing', () => {
    expect(discountExceedsCap('100.00', '0', 0)).toBe(false);
    expect(discountExceedsCap('0', '0', 0)).toBe(false);
    expect(discountExceedsCap('0', '5.00', 50)).toBe(true);
    expect(discountExceedsCap('100.00', '0.01', 0)).toBe(true);         // a cap of 0 means no discounts at all
  });
});

describe('what one unit costs', () => {
  const tiered = { pricing_model: 'tiered', base_price: '0.08', price_rules: [{ min_quantity: '500', unit_price: '0.04' }, { min_quantity: '100', unit_price: '0.06' }] };

  it('uses the best tier the quantity reaches, whatever order the tiers are written in', () => {
    expect(unitPriceFor(tiered, 50)).toBe('0.08');            // below every tier: the base price
    expect(unitPriceFor(tiered, 100)).toBe('0.06');           // exactly at a tier
    expect(unitPriceFor(tiered, 499)).toBe('0.06');
    expect(unitPriceFor(tiered, 500)).toBe('0.04');
    expect(unitPriceFor(tiered, 10_000)).toBe('0.04');
  });

  it('ignores tiers unless the product is priced by them', () => {
    expect(unitPriceFor({ ...tiered, pricing_model: 'per_unit' }, 1000)).toBe('0.08');
    expect(unitPriceFor({ pricing_model: 'fixed', base_price: '25' }, 1000)).toBe('25');
    expect(unitPriceFor({ pricing_model: 'tiered', base_price: '5', price_rules: [] }, 1000)).toBe('5');
  });

  it('never returns a price the order form cannot use', () => {
    expect(unitPriceFor({ pricing_model: 'per_unit', base_price: 'nonsense' }, 1)).toBe('0');
    expect(unitPriceFor({ pricing_model: 'per_unit', base_price: 0.05 }, 1)).toBe('0.05');
  });
});
