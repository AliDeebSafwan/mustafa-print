import type { ChannelProvider, OutboundMessage, SendResult } from '../types';
import { escapeHtml } from '../template-engine';

export interface ResendConfig { apiKey: string; from: string; fetchImpl?: typeof fetch; timeoutMs?: number }

export class ResendEmailProvider implements ChannelProvider {
  readonly channel = 'email' as const;
  readonly name = 'resend';
  constructor(private readonly cfg: ResendConfig) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    const doFetch = this.cfg.fetchImpl ?? fetch;
    const dir = msg.locale === 'ar' ? 'rtl' : 'ltr';
    const html = `<div dir="${dir}" style="font-family:Tahoma,Arial,sans-serif;line-height:1.7">${escapeHtml(msg.body).replace(/\n/g, '<br>')}</div>`;
    let res: Response;
    try {
      res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': msg.logId },
        body: JSON.stringify({ from: this.cfg.from, to: [msg.to], subject: msg.subject ?? '', text: msg.body, html }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch (err) {
      return { ok: false, provider: this.name, retryable: true, code: 'NETWORK', message: err instanceof Error ? err.message : 'network error' };
    }
    const json = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
    if (res.ok && json?.id) return { ok: true, provider: this.name, providerMessageId: json.id };
    return { ok: false, provider: this.name, retryable: res.status === 429 || res.status >= 500, code: json?.name ?? String(res.status), message: json?.message ?? `HTTP ${res.status}` };
  }
}
