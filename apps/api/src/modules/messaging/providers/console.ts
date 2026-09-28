import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Channel, ChannelProvider, OutboundMessage, SendResult } from '../types';

/** Development provider: prints the message instead of sending it. */
export class ConsoleProvider implements ChannelProvider {
  readonly name = 'console';
  constructor(readonly channel: Channel, private readonly log: Logger) {}
  async send(message: OutboundMessage): Promise<SendResult> {
    this.log.info({ channel: this.channel, to: message.to, subject: message.subject, body: message.body, template: message.template?.name }, 'console provider: message not sent (dev mode)');
    return { ok: true, provider: this.name, providerMessageId: `console-${randomUUID()}` };
  }
}

/** Placeholder for a channel that has no real provider yet: fails visibly instead of pretending. */
export class NotConfiguredProvider implements ChannelProvider {
  readonly name = 'not_configured';
  constructor(readonly channel: Channel) {}
  async send(): Promise<SendResult> {
    return { ok: false, provider: this.name, retryable: false, code: 'NOT_CONFIGURED', message: `No provider configured for channel "${this.channel}"` };
  }
}
