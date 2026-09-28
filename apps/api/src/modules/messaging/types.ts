import type { Channel, Locale } from '@mpe/shared';

export type { Channel, Locale };

/** What a channel provider receives. `body` is always the final rendered text. */
export interface OutboundMessage {
  logId: string;
  channel: Channel;
  /** E.164 number for whatsapp/sms, address for email. */
  to: string;
  locale: Locale;
  subject?: string | null;
  body: string;
  /** WhatsApp only: approved template (required for business-initiated messages outside the 24h window). */
  template?: { name: string; language: string; params: string[] } | null;
}

export type SendResult =
  | { ok: true; provider: string; providerMessageId: string }
  | { ok: false; provider: string; retryable: boolean; code?: string; message: string };

export interface ChannelProvider {
  readonly channel: Channel;
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
