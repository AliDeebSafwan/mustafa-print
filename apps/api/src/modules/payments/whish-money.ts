import type { CheckoutRequest, CheckoutSession, PaymentProvider, WebhookOutcome } from './types';

/**
 * Whish Pay (Whish Money merchant wallet gateway) — NOT IMPLEMENTED YET.
 *
 * Whish Pay is a merchant product; its API documentation is only shared after merchant onboarding, so no request/response
 * shapes are guessed here. When you receive the docs + sandbox credentials:
 *   1. implement createCheckout() / handleWebhook() below,
 *   2. mount POST /webhooks/whish (raw body) in src/app.ts,
 *   3. on a verified "paid" event insert a `transactions` row (method='whish_money', provider='whish_money',
 *      provider_txn_id=<their id>) — the unique index on (provider, provider_txn_id) makes webhook retries idempotent,
 *      and the DB trigger updates orders.paid_total / payment_status.
 */
export class WhishMoneyProvider implements PaymentProvider {
  readonly name = 'whish_money';
  async createCheckout(_req: CheckoutRequest): Promise<CheckoutSession> {
    throw new Error('WhishMoneyProvider is not implemented: waiting for merchant API documentation');
  }
  async handleWebhook(): Promise<WebhookOutcome> {
    throw new Error('WhishMoneyProvider is not implemented: waiting for merchant API documentation');
  }
}
