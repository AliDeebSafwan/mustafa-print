import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hasTestDatabase } from './helpers/test-db';
import { mutation, newId, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SITE = 'https://print.example.com';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');

describe.skipIf(!hasTestDatabase)('ordering from the website', () => {
  let s: TestServer;
  let admin: ApiClient, reception: ApiClient, otherAdmin: ApiClient;
  let flyers: string, hidden: string, cards: string;
  let visitors = 0;

  /** A customer's browser: its own address, its session cookie, the site's Origin. */
  const browser = () => {
    const ip = `203.0.113.${++visitors}`;
    let cookie = '';
    const send = async (method: string, path: string, init: { json?: unknown; form?: FormData } = {}) => {
      const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, {
        method,
        headers: { Origin: SITE, 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}), ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      });
      const set = res.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='));
      if (set) cookie = set.split(';')[0]!;
      return res;
    };
    return {
      post: (path: string, json: unknown = {}) => send('POST', path, { json }),
      get: (path: string) => send('GET', path),
      upload: (data: Buffer, name: string) => { const form = new FormData(); form.append('file', new Blob([new Uint8Array(data)]), name); return send('POST', '/files', { form }); },
      uploadForm: (form: FormData) => send('POST', '/files', { form }),
    };
  };
  const customer = async (email: string, verify = true) => {
    const b = browser();
    await b.post('/signup', { email, password: 'a good long password', full_name: 'Karim Saad', locale: 'ar' });
    if (verify) await b.post('/verify', { token: new URL(s.linkFor(email)).searchParams.get('token') });
    else await b.post('/login', { email, password: 'a good long password' });
    return b;
  };
  const checkout = (over: Json = {}) => ({
    request_id: randomUUID(), fulfillment_type: 'pickup', payment_method: 'cash',
    items: [{ product_id: flyers, quantity: '500' }], ...over,
  });
  const product = async (over: Json) => {
    const id = newId();
    const r = await pushOne(admin, mutation('products:insert', id, { sku: `WEB-${id.slice(-6)}`, name_ar: 'منتج', name_en: 'Product', base_price: '1', ...over } as never));
    expect(r.result).toBe('applied');
    return id;
  };

  beforeAll(async () => {
    s = await startTestServer({ PUBLIC_WEB_URL: SITE });
    const { ensureDefaultTemplates } = await import('../src/modules/messaging/default-templates');
    await ensureDefaultTemplates(s.pool);          // as every deployment does
    [admin, reception, otherAdmin] = [await s.as('admin'), await s.as('receptionist'), await s.as('otheradmin')];
    flyers = await product({ name_ar: 'منشورات A5', pricing_model: 'tiered', base_price: '0.08', price_rules: [{ min_quantity: '500', unit_price: '0.04' }], is_public: true, min_quantity: '100' });
    cards = await product({ name_ar: 'بطاقات', base_price: '25', is_public: true });
    hidden = await product({ name_ar: 'داخلي', base_price: '5', is_public: false });
  });
  afterAll(async () => { await s.close(); });

  it('a customer who has not confirmed their email can neither upload nor order', async () => {
    const b = await customer('unverified@example.com', false);
    expect(await jsonOf(await b.post('/orders', checkout()))).toMatchObject({ error: 'email_not_verified' });
    expect(await jsonOf(await b.upload(PDF, 'design.pdf'))).toMatchObject({ error: 'email_not_verified' });
  });

  it('places an order priced from the catalogue, never from the browser, and tells the customer it arrived', async () => {
    const b = await customer('layla@example.com');
    const res = await b.post('/orders', checkout({
      items: [{ product_id: flyers, quantity: '500', unit_price: '0.0001', notes: 'ورق لامع' }, { product_id: cards, quantity: 2 }],
      total: '0.01',
    }));
    expect(res.status).toBe(201);
    const placed = await jsonOf(res);
    expect(placed).toMatchObject({ total: '70.00', currency: 'USD', deliveryFeePending: false });   // 500 x 0.04 + 2 x 25

    const [order] = (await s.pool.query(`SELECT * FROM orders WHERE public_code = $1`, [placed.code])).rows;
    expect(order).toMatchObject({ source: 'web', status: 'pending', payment_method: 'cash', created_by: null });
    const lines = (await s.pool.query(`SELECT unit_price::text, line_total::text, notes FROM order_items WHERE order_id = $1 ORDER BY sort_order`, [order.id])).rows;
    expect(lines).toEqual([{ unit_price: '0.0400', line_total: '20.00', notes: 'ورق لامع' }, { unit_price: '25.0000', line_total: '50.00', notes: null }]);
    expect((await s.pool.query(`SELECT to_status FROM order_status_history WHERE order_id = $1`, [order.id])).rows).toEqual([{ to_status: 'pending' }]);
    expect((await s.pool.query(`SELECT template_key, channel FROM notification_logs WHERE order_id = $1`, [order.id])).rows).toEqual([{ template_key: 'order.pending', channel: 'email' }]);
    expect((await jsonOf<Json[]>(await b.get('/orders'))).map((o) => o.code)).toEqual([placed.code]);
  });

  it('refuses hidden products and quantities below the minimum', async () => {
    const b = await customer('rules@example.com');
    expect(await jsonOf(await b.post('/orders', checkout({ items: [{ product_id: hidden, quantity: 1 }] })))).toMatchObject({ message: 'product_unavailable' });
    expect(await jsonOf(await b.post('/orders', checkout({ items: [{ product_id: flyers, quantity: 50 }] })))).toMatchObject({ message: 'below_minimum:100.000' });
    expect((await b.post('/orders', checkout({ fulfillment_type: 'delivery' }))).status).toBe(400);   // a delivery needs an address
  });

  it('a double click or a retry creates one order, not two', async () => {
    const b = await customer('double@example.com');
    const same = checkout();
    const [a, c] = await Promise.all([b.post('/orders', same), b.post('/orders', same)]);
    const [first, second] = [await jsonOf(a), await jsonOf(c)];
    expect(first.code).toBe(second.code);
    expect((await jsonOf(await b.post('/orders', same))).code).toBe(first.code);
    expect((await s.pool.query(`SELECT count(*)::int AS n FROM orders WHERE id = $1`, [same.request_id])).rows[0].n).toBe(1);
    // and another customer cannot reuse someone else's request id to read their order
    expect((await (await customer('nosy@example.com')).post('/orders', same)).status).toBe(400);
  });

  describe('design files', () => {
    it('keeps a real design privately and attaches it to the right line', async () => {
      const b = await customer('designer@example.com');
      const up = await b.upload(PDF, 'menu.pdf');
      expect(up.status).toBe(201);
      const file = await jsonOf(up);
      expect(file).toMatchObject({ original_name: 'menu.pdf', kind: 'pdf', bytes: String(PDF.length) });

      const placed = await jsonOf(await b.post('/orders', checkout({ items: [{ product_id: cards, quantity: 1, file_ids: [file.id] }] })));
      const [order] = (await s.pool.query(`SELECT id FROM orders WHERE public_code = $1`, [placed.code])).rows;
      const [row] = (await s.pool.query(`SELECT order_id, order_item_id FROM order_files WHERE id = $1`, [file.id])).rows;
      expect(row.order_id).toBe(order.id);
      expect(row.order_item_id).toBeTruthy();

      // staff find it on the order and download the very same bytes, as an attachment
      const files = await jsonOf<Json[]>(await admin.get(`/api/v1/admin/orders/${order.id}/files`));
      expect(files.map((f) => f.original_name)).toEqual(['menu.pdf']);
      const download = await admin.get(`/api/v1/admin/orders/${order.id}/files/${file.id}`);
      expect(download.headers.get('content-disposition')).toContain('attachment');
      expect(Buffer.from(await download.arrayBuffer()).equals(PDF)).toBe(true);
      expect((await otherAdmin.get(`/api/v1/admin/orders/${order.id}/files/${file.id}`)).status).toBe(404);
      expect((await fetch(`${s.baseUrl}/api/v1/admin/orders/${order.id}/files/${file.id}`)).status).toBe(401);
    });

    it('reads the real type from the file: a renamed program is not a PDF', async () => {
      const b = await customer('sneaky@example.com');
      const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(200)]);      // an .exe header
      expect(await jsonOf(await b.upload(exe, 'design.pdf'))).toMatchObject({ error: 'invalid_request', message: 'unsupported_file' });
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
      expect(await jsonOf(await b.upload(png, 'logo.png'))).toMatchObject({ kind: 'png' });
    });

    it("never attaches someone else's file, and refuses anonymous uploads", async () => {
      const owner = await customer('owner@example.com');
      const theirs = await jsonOf(await owner.upload(PDF, 'private.pdf'));
      const thief = await customer('thief@example.com');
      expect(await jsonOf(await thief.post('/orders', checkout({ items: [{ product_id: cards, quantity: 1, file_ids: [theirs.id] }] })))).toMatchObject({ message: 'file_unavailable' });
      expect((await browser().upload(PDF, 'x.pdf')).status).toBe(401);
    });

    it('refuses a stranger before reading the body, not after', async () => {
      // The ordering is the whole point: checked afterwards, a stranger's 401 arrived only once multer had written up
      // to 100 MB to disk and deleted it again — bandwidth and disk spent, nothing left to notice.
      // Two file fields is what separates the two arrangements: the body parser allows one and rejects the pair with
      // 400, so a 401 here can only mean the session was checked before the body was touched.
      const two = new FormData();
      two.append('file', new Blob([new Uint8Array(PDF)]), 'a.pdf');
      two.append('file', new Blob([new Uint8Array(PDF)]), 'b.pdf');
      expect((await browser().uploadForm(two)).status).toBe(401);

      // ...and a signed-in customer still gets the body parser's own verdict on the same request.
      const b = await customer('twofiles@example.com');
      const pair = new FormData();
      pair.append('file', new Blob([new Uint8Array(PDF)]), 'a.pdf');
      pair.append('file', new Blob([new Uint8Array(PDF)]), 'b.pdf');
      expect((await b.uploadForm(pair)).status).toBe(400);
    });

    it('caps what one account may upload, so nobody can fill the disk', async () => {
      const b = await customer('hoarder@example.com');
      const first = await jsonOf(await b.upload(PDF, 'one.pdf'));
      expect(first.id).toBeTruthy();

      // Stand in for an hour of real uploads rather than sending them: the cap is what is under test, not multer.
      const { rows: [account] } = await s.pool.query<{ id: string; branch_id: string }>(
        `SELECT id, branch_id FROM customer_accounts WHERE email = $1`, ['hoarder@example.com']);
      const bulk = Array.from({ length: 20 }, (_, i) =>
        s.pool.query(
          `INSERT INTO order_files (branch_id, storage_key, original_name, kind, bytes, uploaded_by_account)
           VALUES ($1, $2, $3, 'pdf', 1024, $4)`,
          [account!.branch_id, `designs/filler-${account!.id}-${i}.pdf`, `filler-${i}.pdf`, account!.id]));
      await Promise.all(bulk);

      expect(await jsonOf(await b.upload(PDF, 'twentytwo.pdf'))).toMatchObject({ error: 'too_many_attempts', message: 'upload_quota_hourly' });

      // The hourly cap is about rate, not about punishing a returning customer: older uploads stop counting.
      await s.pool.query(`UPDATE order_files SET created_at = clock_timestamp() - interval '2 hours' WHERE uploaded_by_account = $1`, [account!.id]);
      expect((await b.upload(PDF, 'tomorrow.pdf')).status).toBe(201);
    });

    it('removes uploads nobody attached within a day, files included', async () => {
      const b = await customer('forgetful@example.com');
      const file = await jsonOf(await b.upload(PDF, 'forgotten.pdf'));
      const { rows: [row] } = await s.pool.query(`SELECT storage_key FROM order_files WHERE id = $1`, [file.id]);
      await s.pool.query(`UPDATE order_files SET created_at = clock_timestamp() - interval '2 days' WHERE id = $1`, [file.id]);
      const { createWebOrderService } = await import('../src/modules/orders/web-orders.service');
      const { localDiskStorage } = await import('../src/modules/media/storage');
      const removed = await createWebOrderService({ pool: s.pool, storage: localDiskStorage(s.mediaDir), scanner: (await import('../src/modules/media/virus-scan')).disabledScanner, publicWebUrl: SITE }).pruneUnattached();
      expect(removed).toBe(1);
      await expect(readFile(`${s.mediaDir}/${row.storage_key}`)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  describe('a delivery anywhere in Lebanon, priced by the owner', () => {
    it('cannot be confirmed until the owner sets the fee; then the total includes it', async () => {
      const b = await customer('tyre@example.com');
      const placed = await jsonOf(await b.post('/orders', checkout({
        fulfillment_type: 'delivery', payment_method: 'cod', delivery_address: 'شارع البحر', delivery_city: 'صور',
        items: [{ product_id: cards, quantity: 1 }],
      })));
      expect(placed).toMatchObject({ total: '25.00', deliveryFeePending: true });
      const [order] = (await s.pool.query(`SELECT id FROM orders WHERE public_code = $1`, [placed.code])).rows;
      const confirm = () => pushOne(reception, mutation('order_status_history:status_change', newId(), { order_id: order.id, to_status: 'received', source: 'manual', occurred_at: new Date().toISOString() }));

      expect(await confirm()).toMatchObject({ result: 'conflict', error: expect.stringContaining('delivery fee') });
      expect((await reception.post(`/api/v1/admin/orders/${order.id}/delivery-fee`, { fee: '5' })).status).toBe(403);   // the owner decides prices

      const priced = await jsonOf(await admin.post(`/api/v1/admin/orders/${order.id}/delivery-fee`, { fee: '6.5' }));
      expect(priced).toMatchObject({ delivery_fee: '6.50', total: '31.50', delivery_fee_pending: false });
      expect(await confirm()).toMatchObject({ result: 'applied', row: { status: 'received' } });
    });

    it('a pickup order has no fee to wait for, and a fee on a pickup is refused', async () => {
      const b = await customer('pickup@example.com');
      const placed = await jsonOf(await b.post('/orders', checkout({ items: [{ product_id: cards, quantity: 1 }] })));
      const [order] = (await s.pool.query(`SELECT id FROM orders WHERE public_code = $1`, [placed.code])).rows;
      expect(await jsonOf(await admin.post(`/api/v1/admin/orders/${order.id}/delivery-fee`, { fee: '3' }))).toMatchObject({ message: 'not_a_delivery' });
      const confirmed = await pushOne(reception, mutation('order_status_history:status_change', newId(), { order_id: order.id, to_status: 'received', source: 'manual', occurred_at: new Date().toISOString() }));
      expect(confirmed.result).toBe('applied');
    });
  });
});
