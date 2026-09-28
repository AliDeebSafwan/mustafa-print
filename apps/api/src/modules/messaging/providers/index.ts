import type { Logger } from 'pino';
import type { Env } from '../../../config/env';
import type { Channel, ChannelProvider } from '../types';
import { ConsoleProvider, NotConfiguredProvider } from './console';
import { ResendEmailProvider } from './email-resend';
import { WhatsAppCloudProvider } from './whatsapp-cloud';

export function buildProviders(env: Env, log: Logger): Map<Channel, ChannelProvider> {
  const map = new Map<Channel, ChannelProvider>();

  map.set('whatsapp', env.WHATSAPP_PROVIDER === 'cloud'
    ? new WhatsAppCloudProvider({ accessToken: env.WHATSAPP_ACCESS_TOKEN!, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!, apiVersion: env.WHATSAPP_API_VERSION })
    : new ConsoleProvider('whatsapp', log));

  map.set('email', env.EMAIL_PROVIDER === 'resend'
    ? new ResendEmailProvider({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM! })
    : new ConsoleProvider('email', log));

  map.set('sms', env.SMS_PROVIDER === 'console' ? new ConsoleProvider('sms', log) : new NotConfiguredProvider('sms'));
  return map;
}
