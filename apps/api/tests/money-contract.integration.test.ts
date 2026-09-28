import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeOrderTotals, summarizePayments, type MutationInput } from '@mpe/shared';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newCode, newId, pushOne } from './helpers/sync-client';
import { startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

/**
 * The staff app shows totals computed by @mpe/shared before the server has seen the order. If that arithmetic ever
 * differs from PostgreSQL's by a single cent, cashiers see one price and the books say another.
 * These tests throw hundreds of random orders and payments at the real database and compare.
 */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!hasTestDatabase)('client arithmetic matches the database', () => {
  let s: TestServer;
  let reception: ApiClient, admin: ApiClient;
  let customerId: string;

  beforeAll(async () => {
    s = await startTestServer();
    reception = await s.as('receptionist');
    admin = await s.as('admin');
    customerId = await createCustomer(reception);
  });
  afterAll(async () => { await s.close(); });

  const decimals = (rand: () => number, maxWhole: number, places: number) => {
    const whole = Math.floor(rand() * maxWhole);
    const places_ = Math.floor(rand() * (places + 1));
    return places_ === 0 ? String(whole) : `${whole}.${String(Math.floor(rand() * 10 ** places_)).padStart(places_, '0')}`;
  };

  it('agrees on line totals, subtotal and total for 300 random orders (including rounding edge cases)', async () => {
    const rand = mulberry32(20260920);
    let accepted = 0;
    let refused = 0;
    for (let n = 0; n < 300; n++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
        quantity: rand() < 0.5 ? String(1 + Math.floor(rand() * 5000)) : decimals(rand, 200, 4),
        unitPrice: rand() < 0.2 ? ['0.005', '0.0049', '1.2345', '19.99', '0.0001'][Math.floor(rand() * 5)]! : decimals(rand, 300, 4),
        discount: rand() < 0.4 ? decimals(rand, 20, 2) : '0',
      })).filter((l) => Number(l.quantity) > 0);
      if (lines.length === 0) continue;
      const discountTotal = rand() < 0.4 ? decimals(rand, 30, 2) : '0';
      const deliveryFee = rand() < 0.3 ? decimals(rand, 10, 2) : '0';

      const expected = computeOrderTotals({ lines, discountTotal, deliveryFee });
      const id = newId();
      const payload: MutationInput<'orders:insert'> = {
        public_code: newCode(), customer_id: customerId, discount_total: discountTotal, delivery_fee: deliveryFee,
        items: lines.map((l, i) => ({ id: newId(), name_snapshot: `line ${i}`, quantity: l.quantity, unit_price: l.unitPrice, discount: l.discount })),
      };
      const result = await pushOne(reception, mutation('orders:insert', id, payload));

      if (!expected.ok) {
        expect(result.result, JSON.stringify({ lines, discountTotal, deliveryFee, expected })).toBe('rejected');
        refused++;
        continue;
      }
      expect(result.result, JSON.stringify({ lines, discountTotal, deliveryFee, error: result.error })).toBe('applied');
      expect(result.row).toMatchObject({ subtotal: expected.subtotal, discount_total: expected.discountTotal, delivery_fee: expected.deliveryFee, total: expected.total });
      const stored = await s.pool.query<{ line_total: string }>('SELECT line_total::text FROM order_items WHERE order_id = $1 ORDER BY sort_order', [id]);
      expect(stored.rows.map((r) => r.line_total), JSON.stringify(lines)).toEqual(expected.lines);
      accepted++;
    }
    expect(accepted).toBeGreaterThan(150);          // the generator must exercise both outcomes
    expect(refused).toBeGreaterThan(5);
  });

  it('agrees on paid_total and payment_status after random payments and refunds', async () => {
    const rand = mulberry32(42);
    for (let n = 0; n < 12; n++) {
      const total = 20 + Math.floor(rand() * 200);
      const order = await createOrder(reception, customerId, { items: [{ id: newId(), name_snapshot: 'x', quantity: 1, unit_price: total }] });
      const done: { txn_type: string; amount: string }[] = [];
      for (let step = 0; step < 6; step++) {
        const net = summarizePayments(String(total), done);
        const canRefund = Number(net.net) > 0;
        const refund = canRefund && rand() < 0.35;
        const amount = refund ? (Number(net.net) * rand()).toFixed(2) : (1 + rand() * total).toFixed(2);
        if (Number(amount) <= 0) continue;
        const r = await pushOne(admin, mutation('transactions:insert', newId(), { order_id: order.id, txn_type: refund ? 'refund' : 'payment', method: 'cash', amount }));
        expect(r.result, JSON.stringify({ refund, amount, net })).toBe('applied');
        done.push({ txn_type: refund ? 'refund' : 'payment', amount });

        const expected = summarizePayments(String(total), done);
        const { rows } = await s.pool.query<{ paid_total: string; payment_status: string }>('SELECT paid_total::text, payment_status FROM orders WHERE id = $1', [order.id]);
        expect(rows[0], JSON.stringify(done)).toEqual({ paid_total: expected.net, payment_status: expected.status });
      }
    }
  });
});
