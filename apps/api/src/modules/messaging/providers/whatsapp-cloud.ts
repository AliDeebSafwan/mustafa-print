import type { ChannelProvider, OutboundMessage, SendResult } from '../types';

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** WhatsApp rejects template parameters that are empty or contain newlines/tabs/4+ consecutive spaces. */
export function sanitizeTemplateParam(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned === '' ? '-' : cleaned;
}

export function buildPayload(msg: OutboundMessage) {
  const to = msg.to.replace(/^\+/, '');
  if (msg.template) {
    const parameters = msg.template.params.map((p) => ({ type: 'text', text: sanitizeTemplateParam(p) }));
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: msg.template.name,
        language: { code: msg.template.language },
        ...(parameters.length > 0 ? { components: [{ type: 'body', parameters }] } : {}),
      },
    };
  }
  // Free-form text is only delivered inside the 24h customer-service window.
  return { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: true, body: msg.body } };
}

/** Official WhatsApp Business Cloud API (Meta). Unofficial libraries (Baileys) risk number bans; see README. */
export class WhatsAppCloudProvider implements ChannelProvider {
  readonly channel = 'whatsapp' as const;
  readonly name = 'whatsapp_cloud';
  constructor(private readonly cfg: WhatsAppCloudConfig) {}

  buildPayload(msg: OutboundMessage) {
    return buildPayload(msg);
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const doFetch = this.cfg.fetchImpl ?? fetch;
    const url = `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(msg)),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch (err) {
      return { ok: false, provider: this.name, retryable: true, code: 'NETWORK', message: err instanceof Error ? err.message : 'network error' };
    }
    const json = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { code?: number; message?: string } } | null;
    const id = json?.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, provider: this.name, providerMessageId: id };
    return {
      ok: false,
      provider: this.name,
      retryable: res.status === 429 || res.status >= 500,
      code: String(json?.error?.code ?? res.status),
      message: json?.error?.message ?? `HTTP ${res.status}`,
    };
  }
}
