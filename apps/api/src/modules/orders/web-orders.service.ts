import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Pool } from 'pg';
import { generatePublicCode, unitPriceFor, type PriceTier, type WebOrderPlaced, type webOrderInput } from '@mpe/shared';
import type { z } from 'zod';
import { withTransaction } from '../../db/pool';
import { HttpError } from '../../http-error';
import type { AuthContext } from '../auth/types';
import type { CustomerAccountRow } from '../customer-auth/customer-auth.service';
import type { MediaStorage } from '../media/storage';
import { assertFileIsClean, type FileScanner } from '../media/virus-scan';
import { enqueueOrderNotification } from '../messaging/enqueue';
import type { PushService } from '../push/push.service';
import { detectDesignKind } from './design-files';

type Row = Record<string, unknown>;

export interface WebOrderDeps { pool: Pool; storage: MediaStorage; scanner: FileScanner; publicWebUrl: string; onPublicChange?: () => void; push?: PushService }

/** A customer must have proven their email before ordering: the shop needs a way to reach them about it. */
function assertMayOrder(account: CustomerAccountRow): asserts account is CustomerAccountRow & { customer_id: string } {
  if (!account.email_verified_at || !account.customer_id) throw new HttpError(403, 'email_not_verified', 'Confirm your email before ordering');
}

export type WebOrderService = ReturnType<typeof createWebOrderService>;

export function createWebOrderService({ pool, storage, scanner, publicWebUrl, push }: WebOrderDeps) {
  // ---- design files -----------------------------------------------------------------------------------------------
  /** Keeps an uploaded design, if it really is one of the accepted kinds. The temporary upload is always removed. */
  async function uploadDesign(account: CustomerAccountRow, upload: { path: string; originalName: string; bytes: number }): Promise<Row> {
    try {
      assertMayOrder(account);
      const kind = await detectDesignKind(upload.path);
      if (!kind) throw new HttpError(400, 'invalid_request', 'unsupported_file');
      await assertFileIsClean(scanner, upload.path);
      const id = randomUUID();
      const key = `designs/${id}.${kind}`;
      await storage.putFile(key, upload.path);
      const { rows } = await pool.query<Row>(
        `INSERT INTO order_files (id, branch_id, storage_key, original_name, kind, bytes, uploaded_by_account)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, original_name, kind, bytes`,
        [id, account.branch_id, key, upload.originalName.slice(0, 200) || `design.${kind}`, kind, upload.bytes, account.id]);
      return rows[0]!;
    } finally {
      await rm(upload.path, { force: true });
    }
  }

  // ---- placing an order ---------------------------------------------------------------------------------------------
  /**
   * Turns a checkout into a 'pending' order. Prices come from the catalogue, never from the browser. The browser's
   * request_id becomes the order id, so sending the same checkout twice returns the first order instead of a second.
   */
  async function place(account: CustomerAccountRow, input: z.output<typeof webOrderInput>): Promise<WebOrderPlaced> {
    assertMayOrder(account);
    const summary = async (orderId: string): Promise<WebOrderPlaced> => {
      const { rows } = await pool.query<{ code: string; number: string | null; total: string; currency: string; delivery_fee_pending: boolean }>(
        'SELECT public_code AS code, order_number::text AS number, total::text AS total, currency, delivery_fee_pending FROM orders WHERE id = $1', [orderId]);
      const r = rows[0]!;
      return { code: r.code, number: r.number, total: r.total, currency: r.currency, deliveryFeePending: r.delivery_fee_pending };
    };

    const existing = await pool.query<{ customer_id: string }>('SELECT customer_id FROM orders WHERE id = $1', [input.request_id]);
    if (existing.rows[0]) {
      if (existing.rows[0].customer_id !== account.customer_id) throw new HttpError(400, 'invalid_request', 'request_id already used');
      return summary(input.request_id);
    }

    const productIds = [...new Set(input.items.map((i) => i.product_id))];
    const { rows: products } = await pool.query<Row & { id: string }>(
      `SELECT * FROM products WHERE branch_id = $1 AND id = ANY($2::uuid[]) AND is_public AND is_active AND deleted_at IS NULL`,
      [account.branch_id, productIds]);
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = input.items.map((item, index) => {
      const product = byId.get(item.product_id);
      if (!product) throw new HttpError(400, 'invalid_request', 'product_unavailable');
      if (Number(item.quantity) < Number(product.min_quantity ?? 1)) throw new HttpError(400, 'invalid_request', `below_minimum:${product.min_quantity}`);
      const unitPrice = unitPriceFor({ pricing_model: String(product.pricing_model), base_price: String(product.base_price), price_rules: (product.price_rules as PriceTier[]) ?? [] }, item.quantity);
      return { id: randomUUID(), index, product, quantity: item.quantity, unitPrice, notes: item.notes ?? null, fileIds: item.file_ids ?? [] };
    });

    const allFileIds = lines.flatMap((l) => l.fileIds);
    if (new Set(allFileIds).size !== allFileIds.length) throw new HttpError(400, 'invalid_request', 'a file is attached twice');

    const orderId = await withTransaction(pool, async (client) => {
      if (allFileIds.length > 0) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM order_files WHERE id = ANY($1::uuid[]) AND uploaded_by_account = $2 AND order_id IS NULL AND deleted_at IS NULL FOR UPDATE`,
          [allFileIds, account.id]);
        if (rows.length !== allFileIds.length) throw new HttpError(400, 'invalid_request', 'file_unavailable');
      }
      const delivery = input.fulfillment_type === 'delivery';
      await client.query(
        `INSERT INTO orders (id, branch_id, public_code, customer_id, source, status, fulfillment_type, delivery_address, delivery_city, delivery_notes,
                             payment_method, currency, customer_notes, delivery_fee_pending)
         VALUES ($1,$2,$3,$4,'web','pending',$5,$6,$7,$8,$9,(SELECT base_currency FROM branches WHERE id = $2),$10,$11)`,
        [input.request_id, account.branch_id, generatePublicCode(), account.customer_id, input.fulfillment_type,
         delivery ? input.delivery_address : null, delivery ? input.delivery_city : null, delivery ? input.delivery_notes ?? null : null,
         input.payment_method, input.customer_notes ?? null, delivery]);
      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items (id, branch_id, order_id, product_id, sort_order, name_snapshot, unit, quantity, unit_price, discount, line_total, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7, round($8::numeric, 3), round($9::numeric, 4), 0, round(round($8::numeric, 3) * round($9::numeric, 4), 2), $10)`,
          [line.id, account.branch_id, input.request_id, line.product.id, line.index, String(line.product.name_ar), String(line.product.unit),
           line.quantity, line.unitPrice, line.notes]);
        if (line.fileIds.length > 0) {
          await client.query('UPDATE order_files SET order_id = $2, order_item_id = $3 WHERE id = ANY($1::uuid[])', [line.fileIds, input.request_id, line.id]);
        }
      }
      await client.query(
        `UPDATE orders o SET subtotal = s.subtotal, tax_total = branch_vat_amount($2, s.subtotal), total = s.subtotal + branch_vat_amount($2, s.subtotal)
           FROM (SELECT coalesce(sum(line_total), 0) AS subtotal FROM order_items WHERE order_id = $1) s WHERE o.id = $1`,
        [input.request_id, account.branch_id]);
      const code = (await client.query<{ public_code: string }>('SELECT public_code FROM orders WHERE id = $1', [input.request_id])).rows[0]!.public_code;
      await client.query(`INSERT INTO barcodes (branch_id, order_id, label_type, code, symbology) VALUES ($1, $2, 'order', $3, 'qr')`, [account.branch_id, input.request_id, code]);
      await client.query(
        `INSERT INTO order_status_history (branch_id, order_id, from_status, to_status, source, note) VALUES ($1, $2, NULL, 'pending', 'manual', 'placed on the website')`,
        [account.branch_id, input.request_id]);
      await enqueueOrderNotification(client, input.request_id, 'pending', { publicWebUrl });
      return input.request_id;
    }).catch((err) => {
      // Two tabs submitting the same checkout at once: the second loses the race and returns the first's order.
      if ((err as { code?: string; constraint?: string }).code === '23505' && (err as { constraint?: string }).constraint === 'orders_pkey') return input.request_id;
      throw err;
    });
    // A genuine repeat of the same checkout (same request_id, same customer) already returned above, before any
    // insert was attempted — anything that reaches here just created a new order. The one exception is two tabs
    // racing on the very same submission: both would notify here, a harmless double alert for one real order.
    const code = (await pool.query<{ public_code: string }>('SELECT public_code FROM orders WHERE id = $1', [orderId])).rows[0]!.public_code;
    void push?.notifyBranch(account.branch_id, { title: 'طلب جديد من الموقع', body: `طلب #${code} من ${account.full_name}`, url: `/orders/${orderId}` });
    return summary(orderId);
  }

  // ---- the owner prices the delivery ----------------------------------------------------------------------------------
  async function setDeliveryFee(auth: AuthContext, orderId: string, fee: string): Promise<Row> {
    return withTransaction(pool, async (client) => {
      const { rows } = await client.query<Row>(
        'SELECT * FROM orders WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL FOR UPDATE', [orderId, auth.branchId]);
      const order = rows[0];
      if (!order) throw new HttpError(404, 'not_found');
      if (order.fulfillment_type !== 'delivery') throw new HttpError(400, 'invalid_request', 'not_a_delivery');
      if (['delivered', 'cancelled'].includes(String(order.status))) throw new HttpError(400, 'invalid_request', 'order_closed');
      const { rows: saved } = await client.query<Row>(
        `UPDATE orders SET delivery_fee = round($3::numeric, 2),
                tax_total = branch_vat_amount($2, subtotal - discount_total + round($3::numeric, 2)),
                total = subtotal - discount_total + round($3::numeric, 2) + branch_vat_amount($2, subtotal - discount_total + round($3::numeric, 2)),
                delivery_fee_pending = false
          WHERE id = $1 AND branch_id = $2 RETURNING *`, [orderId, auth.branchId, fee]);
      return saved[0]!;
    });
  }

  // ---- staff reach the files --------------------------------------------------------------------------------------------
  const listFiles = async (auth: AuthContext, orderId: string): Promise<Row[]> =>
    (await pool.query<Row>(
      `SELECT id, order_item_id, original_name, kind, bytes, created_at FROM order_files
        WHERE order_id = $1 AND branch_id = $2 AND deleted_at IS NULL ORDER BY created_at`, [orderId, auth.branchId])).rows;

  async function fileForStaff(auth: AuthContext, orderId: string, fileId: string): Promise<{ path: string; name: string }> {
    const { rows } = await pool.query<{ storage_key: string; original_name: string }>(
      'SELECT storage_key, original_name FROM order_files WHERE id = $1 AND order_id = $2 AND branch_id = $3 AND deleted_at IS NULL',
      [fileId, orderId, auth.branchId]);
    const file = rows[0];
    const path = file ? await storage.pathOf(file.storage_key) : null;
    if (!file || !path) throw new HttpError(404, 'not_found');
    return { path, name: file.original_name };
  }

  /** Uploads nobody attached to an order within a day are removed, files and rows. */
  async function pruneUnattached(): Promise<number> {
    const { rows } = await pool.query<{ storage_key: string }>(
      `UPDATE order_files SET deleted_at = clock_timestamp()
        WHERE order_id IS NULL AND deleted_at IS NULL AND created_at < clock_timestamp() - interval '1 day' RETURNING storage_key`);
    await Promise.all(rows.map((r) => storage.remove(r.storage_key)));
    return rows.length;
  }

  return { uploadDesign, place, setDeliveryFee, listFiles, fileForStaff, pruneUnattached };
}
