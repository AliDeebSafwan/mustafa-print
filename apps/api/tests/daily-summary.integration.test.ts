import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createDailySummaryService } from '../src/modules/reports/daily-summary.service';
import type { ChannelProvider, OutboundMessage, SendResult } from '../src/modules/messaging/types';
import { hasTestDatabase } from './helpers/test-db';
import { createCustomer, createOrder, mutation, newId, pushOne } from './helpers/sync-client';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('the owner\'s end-of-day email', () => {
  let s: TestServer, admin: ApiClient, staff: ApiClient;
  const sent: OutboundMessage[] = [];
  let nextResult: SendResult = { ok: true, provider: 'fake', providerMessageId: 'm1' };
  const mailer: ChannelProvider = { channel: 'email', name: 'fake', send: async (m) => { sent.push(m); return nextResult; } };
  let service: ReturnType<typeof createDailySummaryService>;
  const branch = () => s.fixtures.branchId;
  const setBranch = (set: string, ...params: unknown[]) => s.pool.query(`UPDATE branches SET ${set} WHERE id = $1`, [branch(), ...params]);

  beforeAll(async () => {
    s = await startTestServer(); admin = await s.as('admin'); staff = await s.as('staff');
    service = createDailySummaryService({ pool: s.pool, mailer, log: pino({ level: 'silent' }) });
  });
  afterAll(async () => { await s.close(); });
  beforeEach(async () => {
    sent.length = 0; nextResult = { ok: true, provider: 'fake', providerMessageId: 'm1' };
    await setBranch(`summary_email = NULL, summary_hour = 0, summary_last_date = NULL`);
  });

  it('sends nothing until an address is set', async () => {
    expect(await service.sendDue()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('sends the real figures once the hour has come, and only once that day', async () => {
    const customerId = await createCustomer(staff, { full_name: 'Karim' } as never);
    const order = await createOrder(staff, customerId, { items: [{ id: newId(), name_snapshot: 'Banner', quantity: '1', unit_price: '40' }] } as never);
    await pushOne(staff, mutation('transactions:insert', newId(), { order_id: order.id, txn_type: 'payment', method: 'cash', amount: '15' } as never));
    await setBranch(`summary_email = 'owner@example.com'`);

    expect(await service.sendDue()).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'email', to: 'owner@example.com' });
    const body = sent[0]!.body;
    expect(body).toMatch(/الطلبات الواردة: \d+/);
    expect(body).toMatch(/ذمم غير مسدَّدة: \d+ طلب بإجمالي \d+\.\d\d USD/);
    expect(sent[0]!.subject).toContain('ملخص اليوم');

    expect(await service.sendDue()).toBe(0);   // the same day never goes out twice
    expect(sent).toHaveLength(1);
  });

  it('two workers ticking at the same moment still send the day once', async () => {
    await setBranch(`summary_email = 'owner@example.com'`);
    const results = await Promise.all([service.sendDue(), service.sendDue(), service.sendDue()]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('waits for the configured hour, in the shop\'s own timezone', async () => {
    const { rows: [now] } = await s.pool.query<{ h: number }>(`SELECT extract(hour FROM now() AT TIME ZONE timezone)::int AS h FROM branches WHERE id = $1`, [branch()]);
    await setBranch(`summary_email = 'owner@example.com', summary_hour = $2`, Math.min(23, now!.h + 1));
    if (now!.h < 23) {
      expect(await service.sendDue()).toBe(0);
      expect(sent).toHaveLength(0);
    }
    await setBranch(`summary_hour = $2`, now!.h);   // the hour has now arrived
    expect(await service.sendDue()).toBe(1);
  });

  it('gives the day back when the mail service refuses, and does not hammer it on the very next tick', async () => {
    await setBranch(`summary_email = 'owner@example.com'`);
    nextResult = { ok: false, provider: 'fake', retryable: true, message: 'down' };
    expect(await service.sendDue()).toBe(0);
    expect(sent).toHaveLength(1);
    expect((await s.pool.query('SELECT summary_last_date FROM branches WHERE id = $1', [branch()])).rows[0].summary_last_date).toBeNull();   // still owed

    expect(await service.sendDue()).toBe(0);
    expect(sent).toHaveLength(1);   // throttled: the mail service is not asked again straight away
    expect((await s.pool.query('SELECT summary_last_date FROM branches WHERE id = $1', [branch()])).rows[0].summary_last_date).toBeNull();
  });

  describe('setting it up from the staff app', () => {
    const save = async (client: ApiClient, data: Json) => {
      const current = await jsonOf<Json>(await client.get('/api/v1/admin/team/branch-settings'));
      return fetch(`${s.baseUrl}/api/v1/admin/team/branch-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` },
        body: JSON.stringify({ row_version: current.row_version, data }),
      });
    };
    it('lets the owner set and clear the address and hour, and refuses a malformed one', async () => {
      expect(await jsonOf<Json>(await save(admin, { summary_email: 'Owner@Example.com', summary_hour: 20 }))).toMatchObject({ summary_email: 'owner@example.com', summary_hour: 20 });
      expect((await save(admin, { summary_email: 'not-an-email' })).status).toBe(400);
      expect((await save(admin, { summary_hour: 24 })).status).toBe(400);
      expect(await jsonOf<Json>(await save(admin, { summary_email: null }))).toMatchObject({ summary_email: null, summary_hour: 20 });   // off; the hour is remembered
    });
    it('is the owner\'s alone', async () => {
      expect((await save(staff, { summary_email: 'staff@example.com' })).status).toBe(403);
    });
  });
});
