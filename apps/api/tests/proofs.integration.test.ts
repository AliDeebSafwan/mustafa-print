import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const png = (seed: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(seed.padEnd(64, '.'))]);

describe.skipIf(!hasTestDatabase)('proof approval', () => {
  let s: TestServer;
  let admin: ApiClient, staff: ApiClient, operator: ApiClient, otherAdmin: ApiClient;
  beforeAll(async () => { s = await startTestServer(); [admin, staff, operator, otherAdmin] = [await s.as('admin'), await s.as('staff'), await s.as('operator'), await s.as('otheradmin')]; });
  afterAll(async () => { await s.close(); });

  const upload = (client: ApiClient, orderId: string, data: Buffer, name = 'proof.png') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), name);
    return fetch(`${s.baseUrl}/api/v1/admin/orders/${orderId}/proofs`, { method: 'POST', headers: { Authorization: `Bearer ${client.token}` }, body: form });
  };
  const pub = {
    view: (code: string) => fetch(`${s.baseUrl}/api/v1/public/proofs/${code}`),
    file: (code: string) => fetch(`${s.baseUrl}/api/v1/public/proofs/${code}/file`),
    respond: (code: string, decision: string, comment?: string) => fetch(`${s.baseUrl}/api/v1/public/proofs/${code}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, ...(comment ? { comment } : {}) }) }),
  };
  const orderRow = async (id: string) => (await s.pool.query(`SELECT status, proof_status FROM orders WHERE id = $1`, [id])).rows[0];
  const newOrder = async () => (await createOrder(staff, await createCustomer(staff))).id;

  it('uploading a proof moves the order to awaiting approval and gives the customer a link', async () => {
    const orderId = await newOrder();
    const res = await upload(staff, orderId, png('v1'));
    expect(res.status).toBe(201);
    const proof = await jsonOf<Json>(res);
    expect(proof).toMatchObject({ version: 1, kind: 'png', status: 'pending' });
    expect(proof.link).toBe(`https://print.example.com/ar/proof/${proof.public_code}`);
    expect(await orderRow(orderId)).toEqual({ status: 'awaiting_approval', proof_status: 'pending' });
    const { rows } = await s.pool.query(`SELECT to_status, source FROM order_status_history WHERE order_id = $1 ORDER BY occurred_at`, [orderId]);
    expect(rows.map((r) => r.to_status)).toEqual(['received', 'in_design', 'awaiting_approval']);   // walks the state machine, no shortcut
  });

  it('the customer sees the proof and its file, and nothing internal', async () => {
    const orderId = await newOrder();
    const file = png('customer view');
    const proof = await jsonOf<Json>(await upload(staff, orderId, file));
    const view = await jsonOf<Json>(await pub.view(proof.public_code));
    expect(view).toMatchObject({ version: 1, kind: 'png', status: 'pending', isLatest: true, responses: [] });
    expect(JSON.stringify(view)).not.toMatch(/storage_key|sha256|proofs\//);
    const got = await pub.file(proof.public_code);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await got.arrayBuffer()).equals(file)).toBe(true);
  });

  it('approval is recorded against the exact version and file, and cannot be given twice', async () => {
    const orderId = await newOrder();
    const file = png('the approved one');
    const proof = await jsonOf<Json>(await upload(staff, orderId, file));
    expect(await jsonOf<Json>(await pub.respond(proof.public_code, 'approved'))).toEqual({ status: 'approved' });

    const { rows: [answer] } = await s.pool.query(`SELECT proof_version, file_sha256, decision FROM proof_responses WHERE order_id = $1`, [orderId]);
    expect(answer).toEqual({ proof_version: 1, file_sha256: createHash('sha256').update(file).digest('hex'), decision: 'approved' });
    // Approval does not start printing: moving to printing is the counter's call (deposit rule, stock deduction).
    expect(await orderRow(orderId)).toEqual({ status: 'awaiting_approval', proof_status: 'approved' });
    expect(await jsonOf<Json>(await pub.respond(proof.public_code, 'approved'))).toMatchObject({ message: 'proof_answered' });
  });

  it('the answer can never be edited or deleted, not even directly in the database', async () => {
    const orderId = await newOrder();
    const proof = await jsonOf<Json>(await upload(staff, orderId, png('evidence')));
    await pub.respond(proof.public_code, 'approved');
    await expect(s.pool.query(`UPDATE proof_responses SET decision = 'changes_requested', comment = 'x' WHERE order_id = $1`, [orderId])).rejects.toThrow(/append-only/);
    await expect(s.pool.query(`DELETE FROM proof_responses WHERE order_id = $1`, [orderId])).rejects.toThrow(/append-only/);
  });

  it('asking for changes needs a comment, and sends the job back to design with that comment on record', async () => {
    const orderId = await newOrder();
    const proof = await jsonOf<Json>(await upload(staff, orderId, png('needs work')));
    expect(await jsonOf<Json>(await pub.respond(proof.public_code, 'changes_requested'))).toMatchObject({ message: 'comment_required' });
    expect((await pub.respond(proof.public_code, 'changes_requested', 'Please make the logo bigger')).status).toBe(200);
    expect(await orderRow(orderId)).toEqual({ status: 'in_design', proof_status: 'changes_requested' });
    const { rows } = await s.pool.query(`SELECT note FROM order_status_history WHERE order_id = $1 AND to_status = 'in_design' ORDER BY occurred_at DESC LIMIT 1`, [orderId]);
    expect(rows[0].note).toContain('Please make the logo bigger');
  });

  it('a new version replaces the old link: the old one says so and cannot be answered', async () => {
    const orderId = await newOrder();
    const v1 = await jsonOf<Json>(await upload(staff, orderId, png('first')));
    await pub.respond(v1.public_code, 'changes_requested', 'Wrong colour');
    const v2 = await jsonOf<Json>(await upload(staff, orderId, png('second')));
    expect(v2.version).toBe(2);
    expect(await orderRow(orderId)).toEqual({ status: 'awaiting_approval', proof_status: 'pending' });   // back from design to approval

    const v3 = await jsonOf<Json>(await upload(staff, orderId, png('third')));
    expect(await jsonOf<Json>(await pub.view(v2.public_code))).toMatchObject({ status: 'superseded', isLatest: false });
    expect(await jsonOf<Json>(await pub.respond(v2.public_code, 'approved'))).toMatchObject({ message: 'proof_superseded' });
    expect((await pub.respond(v3.public_code, 'approved')).status).toBe(200);

    const history = await jsonOf<Json[]>(await staff.get(`/api/v1/admin/orders/${orderId}/proofs`));
    expect(history.map((p) => [p.version, p.status])).toEqual([[3, 'approved'], [2, 'superseded'], [1, 'changes_requested']]);
    expect(history[2]!.responses).toMatchObject([{ decision: 'changes_requested', comment: 'Wrong colour' }]);
  });

  describe('refusals', () => {
    it('no proof once printing has started, and only files a phone can show', async () => {
      const orderId = await newOrder();
      expect((await pushOne(staff, mutation('order_status_history:status_change', newId(), { order_id: orderId, to_status: 'printing', source: 'manual', occurred_at: new Date().toISOString() }))).result).toBe('applied');
      expect(await jsonOf<Json>(await upload(staff, orderId, png('late')))).toMatchObject({ message: 'order_past_design' });

      const other = await newOrder();
      const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(100)]);
      expect(await jsonOf<Json>(await upload(staff, other, exe, 'proof.pdf'))).toMatchObject({ message: 'unsupported_file' });
      const psd = Buffer.concat([Buffer.from([0x38, 0x42, 0x50, 0x53]), Buffer.alloc(100)]);   // a real design file, but no phone opens it
      expect(await jsonOf<Json>(await upload(staff, other, psd, 'proof.psd'))).toMatchObject({ message: 'unsupported_file' });
      expect(await orderRow(other)).toEqual({ status: 'received', proof_status: null });          // nothing moved
    });

    it('needs permission, and never reaches another branch\'s order', async () => {
      const orderId = await newOrder();
      expect((await upload(operator, orderId, png('x'))).status).toBe(403);
      expect((await upload(otherAdmin, orderId, png('x'))).status).toBe(404);
      expect((await pub.view('ZZZZZZZZZZZZ')).status).toBe(404);
      void admin;
    });
  });
});
