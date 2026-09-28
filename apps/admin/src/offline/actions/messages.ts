import { uuidv7 } from '@mpe/shared'
import { db, type CustomerRow, type NotificationLogRow } from '../db'
import { newMutation } from './mutation'

export type MessageErrorCode = 'order_missing' | 'customer_missing' | 'empty_message' | 'not_consented'
export class MessageError extends Error {
  readonly code: MessageErrorCode
  constructor(code: MessageErrorCode) { super(code); this.name = 'MessageError'; this.code = code }
}

export interface NewMessageInput { orderId: string; channel: 'whatsapp' | 'sms' | 'email'; body: string }

/** Which channels this customer can actually be reached on, given what they consented to when registered. */
export function consentedChannels(customer: Pick<CustomerRow, 'whatsapp_opt_in' | 'sms_opt_in' | 'email_opt_in' | 'phone_e164' | 'email'>): ('whatsapp' | 'sms' | 'email')[] {
  const channels: ('whatsapp' | 'sms' | 'email')[] = []
  if (customer.whatsapp_opt_in && customer.phone_e164) channels.push('whatsapp')
  if (customer.sms_opt_in && customer.phone_e164) channels.push('sms')
  if (customer.email_opt_in && customer.email) channels.push('email')
  return channels
}

/**
 * Queues a free-text message to the customer on an order. Refused up front if they never consented to that
 * channel — the same check the server makes again once this reaches it, so nothing relies on trusting the device.
 */
export async function sendManualMessageLocally(input: NewMessageInput): Promise<NotificationLogRow> {
  const order = await db.orders.get(input.orderId)
  if (!order) throw new MessageError('order_missing')
  const customer = await db.customers.get(order.customer_id)
  if (!customer) throw new MessageError('customer_missing')
  const body = input.body.trim()
  if (!body) throw new MessageError('empty_message')
  if (!consentedChannels(customer).includes(input.channel)) throw new MessageError('not_consented')

  const id = uuidv7()
  const recipient = input.channel === 'email' ? (customer.email ?? '') : (customer.phone_e164 ?? '')
  const row: NotificationLogRow = {
    id, order_id: order.id, customer_id: customer.id, channel: input.channel, trigger: 'manual', recipient,
    body, status: 'queued', queued_at: new Date().toISOString(), _pending: true,
  }
  const mutation = newMutation('notification_logs:manual_send', id, { order_id: order.id, channel: input.channel, body })
  await db.transaction('rw', db.notification_logs, db.outbox, async () => {
    await db.notification_logs.add(row)
    await db.outbox.add(mutation)
  })
  return row
}
