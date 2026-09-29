import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScannerUnavailable, type FileScanner, type ScanResult } from '../src/modules/media/virus-scan';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SITE = 'https://print.example.com';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const png = (seed: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(seed.padEnd(64, '.'))]);

describe.skipIf(!hasTestDatabase)('every uploaded file is scanned before it is kept', () => {
  let s: TestServer, staff: ApiClient;
  let verdict: () => Promise<ScanResult> = async () => ({ clean: true });
  const scanned: string[] = [];
  const scanner: FileScanner = { enabled: true, scanFile: async (path) => { scanned.push(path); return verdict(); } };
  let visitors = 0;

  beforeAll(async () => { s = await startTestServer({}, { scanner }); staff = await s.as('staff'); });
  afterAll(async () => { await s.close(); });
  beforeEach(() => { verdict = async () => ({ clean: true }); scanned.length = 0; });

  const storedFiles = async () => (await readdir(`${s.mediaDir}`, { recursive: true }).catch(() => [] as string[])).filter((f) => /^(designs|proofs)\//.test(String(f))).length;

  const customerBrowser = async (email: string) => {
    const ip = `198.51.100.${++visitors}`;
    let cookie = '';
    const send = async (path: string, init: { json?: unknown; form?: FormData } = {}) => {
      const res = await fetch(`${s.baseUrl}/api/v1/public/account${path}`, {
        method: 'POST', headers: { Origin: SITE, 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}), ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      });
      const set = res.headers.getSetCookie().find((c) => c.startsWith('mpe_customer='));
      if (set) cookie = set.split(';')[0]!;
      return res;
    };
    await send('/signup', { json: { email, password: 'a good long password', full_name: 'Karim Saad', locale: 'ar' } });
    await send('/verify', { json: { token: new URL(s.linkFor(email)).searchParams.get('token') } });
    return { upload: (data: Buffer, name: string) => { const form = new FormData(); form.append('file', new Blob([new Uint8Array(data)]), name); return send('/files', { form }); } };
  };

  describe('a customer\'s design file', () => {
    it('is kept when the scanner says it is clean, and the scanner really was asked', async () => {
      const b = await customerBrowser('clean-design@example.com');
      const res = await b.upload(PDF, 'menu.pdf');
      expect(res.status).toBe(201);
      expect(scanned).toHaveLength(1);
      expect(await storedFiles()).toBe(1);
    });

    it('is refused with a reason when the scanner finds something, and nothing is kept', async () => {
      const before = await storedFiles();
      const rows = async () => Number((await s.pool.query('SELECT count(*)::int AS n FROM order_files')).rows[0].n);
      const rowsBefore = await rows();
      verdict = async () => ({ clean: false, signature: 'Eicar-Test-Signature' });
      const b = await customerBrowser('infected-design@example.com');
      const res = await b.upload(PDF, 'menu.pdf');
      expect(res.status).toBe(400);
      expect(await jsonOf(res)).toMatchObject({ error: 'invalid_request', message: 'infected_file' });
      expect(await storedFiles()).toBe(before);       // not on disk
      expect(await rows()).toBe(rowsBefore);          // not in the database
    });

    it('is refused, not waved through, when the scanner cannot answer', async () => {
      const before = await storedFiles();
      verdict = async () => { throw new ScannerUnavailable('clamd is down'); };
      const b = await customerBrowser('down-design@example.com');
      const res = await b.upload(PDF, 'menu.pdf');
      expect(res.status).toBe(503);
      expect(await jsonOf(res)).toMatchObject({ message: 'scanner_unavailable' });
      expect(await storedFiles()).toBe(before);
    });

    it('is not sent to the scanner at all when it is not even a real design type', async () => {
      const b = await customerBrowser('not-a-design@example.com');
      const res = await b.upload(Buffer.from('MZ this is a program'), 'design.pdf');
      expect(await jsonOf(res)).toMatchObject({ message: 'unsupported_file' });
      expect(scanned).toHaveLength(0);
    });
  });

  describe('a proof the staff upload for the customer to approve', () => {
    const order = async () => createOrder(staff, await createCustomer(staff, { full_name: 'Proof Customer' } as never));
    const upload = (orderId: string, data: Buffer) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(data)]), 'proof.png');
      return fetch(`${s.baseUrl}/api/v1/admin/orders/${orderId}/proofs`, { method: 'POST', headers: { Authorization: `Bearer ${staff.token}` }, body: form });
    };

    it('is kept when clean', async () => {
      const o = await order();
      expect((await upload(o.id, png('clean'))).status).toBe(201);
      expect(scanned).toHaveLength(1);
    });

    it('is refused when infected, leaving the order untouched and no proof recorded', async () => {
      const o = await order();
      verdict = async () => ({ clean: false, signature: 'Eicar-Test-Signature' });
      const res = await upload(o.id, png('bad'));
      expect(res.status).toBe(400);
      expect(await jsonOf(res)).toMatchObject({ message: 'infected_file' });
      expect(Number((await s.pool.query('SELECT count(*)::int AS n FROM proofs WHERE order_id = $1', [o.id])).rows[0].n)).toBe(0);
      expect((await s.pool.query('SELECT status FROM orders WHERE id = $1', [o.id])).rows[0].status).toBe('received');
    });

    it('is refused when the scanner cannot answer', async () => {
      const o = await order();
      verdict = async () => { throw new ScannerUnavailable('down'); };
      expect((await upload(o.id, png('down'))).status).toBe(503);
    });
  });
});
