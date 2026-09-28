import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTestDatabase } from './helpers/test-db';
import { jsonOf, startTestServer, type ApiClient, type TestServer } from './helpers/test-server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!hasTestDatabase)('editing the messages customers receive', () => {
  let s: TestServer;
  let admin: ApiClient, reception: ApiClient;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    s = await startTestServer();
    admin = await s.as('admin');
    reception = await s.as('receptionist');
    const insert = async (key: string, channel: string, body: string, variables: string[], approved: string | null, subject: string | null = null) =>
      (await s.pool.query<{ id: string }>(
        `INSERT INTO notification_templates (branch_id, template_key, channel, locale, body, variables, provider_template_name, provider_template_language, subject)
         VALUES ($1,$2,$3,'ar',$4,$5,$6,$7,$8) RETURNING id`, [s.fixtures.branchId, key, channel, body, variables, approved, approved ? 'ar' : null, subject])).rows[0]!.id;
    ids.wa = await insert('order.received', 'whatsapp', 'أهلاً {{customer_name}}، طلبك {{order_id}}: {{tracking_url}}', ['customer_name', 'order_id', 'tracking_url'], 'order_received_v1');
    ids.sms = await insert('order.ready', 'sms', 'طلبك {{order_id}} جاهز', ['order_id'], null);
    ids.email = await insert('order.invoice', 'email', 'فاتورة {{order_id}}', ['order_id'], null, 'فاتورتك');
  });
  afterAll(async () => { await s.close(); });

  const put = (client: ApiClient, id: string, body: unknown) =>
    fetch(`${s.baseUrl}/api/v1/admin/templates/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${client.token}` }, body: JSON.stringify(body) });
  const version = async (id: string) => (await s.pool.query<{ row_version: number }>('SELECT row_version FROM notification_templates WHERE id = $1', [id])).rows[0]!.row_version;

  it('the owner changes an SMS and the variable list follows the new text', async () => {
    const res = await put(admin, ids.sms!, { row_version: await version(ids.sms!), data: { body: '{{customer_name}}، طلبك {{order_id}} جاهز للاستلام' } });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toMatchObject({ body: '{{customer_name}}، طلبك {{order_id}} جاهز للاستلام', variables: ['customer_name', 'order_id'] });
  });

  it('refuses a misspelled variable, which would otherwise stop the message from ever being sent', async () => {
    const res = await put(admin, ids.sms!, { row_version: await version(ids.sms!), data: { body: 'طلبك {{order_idd}} جاهز' } });
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toMatchObject({ error: 'invalid_request', message: 'unknown_variables' });
  });

  it('protects an approved WhatsApp template from a silent mix-up, and allows it with a new approval', async () => {
    const reordered = { body: 'طلبك {{order_id}} يا {{customer_name}}: {{tracking_url}}' };
    const refused = await put(admin, ids.wa!, { row_version: await version(ids.wa!), data: reordered });
    expect(await jsonOf(refused)).toMatchObject({ message: 'whatsapp_variables_changed' });

    const approved = await put(admin, ids.wa!, { row_version: await version(ids.wa!), data: { ...reordered, provider_template_name: 'order_received_v2' } });
    expect(await jsonOf(approved)).toMatchObject({ provider_template_name: 'order_received_v2', variables: ['order_id', 'customer_name', 'tracking_url'] });
  });

  it('an email keeps its subject, a save over a newer version is refused, and the worker may read but not edit', async () => {
    expect((await put(admin, ids.email!, { row_version: await version(ids.email!), data: { body: 'فاتورة {{order_id}}', subject: '' } })).status).toBe(400);
    const stale = await put(admin, ids.email!, { row_version: 999, data: { body: 'x', subject: 'y' } });
    expect(stale.status).toBe(409);
    expect((await reception.get('/api/v1/admin/templates')).status).toBe(200);
    expect((await put(reception, ids.sms!, { row_version: await version(ids.sms!), data: { body: 'x' } })).status).toBe(403);
  });

  it('turning a message off keeps its text', async () => {
    const res = await put(admin, ids.sms!, { row_version: await version(ids.sms!), data: { body: '{{customer_name}}، طلبك {{order_id}} جاهز للاستلام', is_active: false } });
    expect(await jsonOf(res)).toMatchObject({ is_active: false, body: '{{customer_name}}، طلبك {{order_id}} جاهز للاستلام' });
  });
});
