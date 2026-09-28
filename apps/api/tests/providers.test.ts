import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { ResendEmailProvider } from '../src/modules/messaging/providers/email-resend';
import { WhatsAppCloudProvider, sanitizeTemplateParam } from '../src/modules/messaging/providers/whatsapp-cloud';
import { extractStatuses, verifyMetaSignature } from '../src/routes/whatsapp-webhook';
import { backoffMs } from '../src/modules/messaging/outbox-worker';
import { pickChannel } from '../src/modules/messaging/enqueue';

const msg = { logId: '00000000-0000-4000-8000-000000000001', channel: 'whatsapp' as const, to: '+96170123456', locale: 'ar' as const, body: 'hello' };

describe('whatsapp cloud provider', () => {
  const make = (fetchImpl: typeof fetch) => new WhatsAppCloudProvider({ accessToken: 't', phoneNumberId: '123', apiVersion: 'v23.0', fetchImpl });
  it('builds a template payload with positional params and strips the + from the number', () => {
    const p = make(fetch).buildPayload({ ...msg, template: { name: 'mpe_order_ready', language: 'ar', params: ['علي', '1042'] } }) as any;
    expect(p.to).toBe('96170123456');
    expect(p.type).toBe('template');
    expect(p.template.language.code).toBe('ar');
    expect(p.template.components[0].parameters).toEqual([{ type: 'text', text: 'علي' }, { type: 'text', text: '1042' }]);
  });
  it('sanitizes parameters that WhatsApp rejects', () => {
    expect(sanitizeTemplateParam('a\nb\t c')).toBe('a b c');
    expect(sanitizeTemplateParam('')).toBe('-');
  });
  it('maps success, retryable and permanent failures', async () => {
    const ok = await make((async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 })) as typeof fetch).send(msg);
    expect(ok).toMatchObject({ ok: true, providerMessageId: 'wamid.X' });
    const limited = await make((async () => new Response(JSON.stringify({ error: { code: 4, message: 'rate' } }), { status: 429 })) as typeof fetch).send(msg);
    expect(limited).toMatchObject({ ok: false, retryable: true });
    const bad = await make((async () => new Response(JSON.stringify({ error: { code: 131030, message: 'not in allowed list' } }), { status: 400 })) as typeof fetch).send(msg);
    expect(bad).toMatchObject({ ok: false, retryable: false, code: '131030' });
    const down = await make((async () => { throw new Error('ECONNRESET'); }) as typeof fetch).send(msg);
    expect(down).toMatchObject({ ok: false, retryable: true, code: 'NETWORK' });
  });
});

describe('resend email provider', () => {
  it('escapes the html body and sets an idempotency key', async () => {
    let seen: { headers: Record<string, string>; body: any } | undefined;
    const p = new ResendEmailProvider({ apiKey: 'k', from: 'a@b.c', fetchImpl: (async (_u: unknown, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
    }) as typeof fetch });
    const r = await p.send({ ...msg, channel: 'email', to: 'x@y.z', subject: 'S', body: '<script>x</script>\nline2' });
    expect(r).toMatchObject({ ok: true, providerMessageId: 'em_1' });
    expect(seen!.headers['Idempotency-Key']).toBe(msg.logId);
    expect(seen!.body.html).toContain('&lt;script&gt;');
    expect(seen!.body.html).toContain('<br>');
    expect(seen!.body.html).toContain('dir="rtl"');
  });
});

describe('whatsapp webhook', () => {
  const secret = 'app-secret';
  const body = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1700000000' }] } }] }] }));
  it('verifies Meta signatures in constant time and rejects tampering', () => {
    const good = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyMetaSignature(body, good, secret)).toBe(true);
    expect(verifyMetaSignature(Buffer.from(body.toString() + ' '), good, secret)).toBe(false);
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=zz', secret)).toBe(false);
  });
  it('extracts statuses', () => {
    expect(extractStatuses(JSON.parse(body.toString()))).toHaveLength(1);
    expect(extractStatuses({})).toEqual([]);
  });
});

describe('worker helpers', () => {
  it('backs off exponentially with a 1h cap', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
  it('picks the preferred consented channel, falls back, and never messages without consent', () => {
    const base = { id: 'c', fullName: 'A', phone: '+96170000000', email: 'a@b.c', locale: 'ar' as const, whatsappOptIn: false, smsOptIn: false, emailOptIn: false, preferredChannel: 'whatsapp' as const };
    expect(pickChannel(base)).toBeNull();
    expect(pickChannel({ ...base, whatsappOptIn: true })).toEqual({ channel: 'whatsapp', recipient: '+96170000000' });
    expect(pickChannel({ ...base, emailOptIn: true })).toEqual({ channel: 'email', recipient: 'a@b.c' });
    expect(pickChannel({ ...base, whatsappOptIn: true, emailOptIn: true, preferredChannel: 'email' })).toEqual({ channel: 'email', recipient: 'a@b.c' });
    expect(pickChannel({ ...base, whatsappOptIn: true, phone: null })).toBeNull();
  });
});
