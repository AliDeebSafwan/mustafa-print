/**
 * Payment provider contract. Cash and COD need no provider (staff record them directly as transactions).
 * Online wallet payments go through a provider adapter.
 *
 * Whish Pay: the merchant API is issued to onboarded merchants and its documentation is not public, so the adapter
 * below is a typed stub. Fill it in once you have the merchant docs/credentials; nothing else in the app changes.
 */
export interface CheckoutRequest {
  orderId: string;
  publicCode: string;
  amount: string;        // decimal string, e.g. "12.50"
  currency: string;      // ISO 4217, e.g. "USD"
  successUrl: string;
  cancelUrl: string;
}
export interface CheckoutSession { providerTxnId: string; redirectUrl: string }

export type WebhookOutcome =
  | { kind: 'ignored' }
  | { kind: 'payment'; providerTxnId: string; status: 'completed' | 'failed' | 'cancelled'; amount?: string; raw: unknown };

export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Must verify authenticity (signature / shared secret) BEFORE trusting the body. */
  handleWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<WebhookOutcome>;
}

export class WhishPayProvider implements PaymentProvider {
  readonly name = 'whish_money';
  async createCheckout(): Promise<CheckoutSession> {
    throw new Error('WhishPayProvider is not implemented: obtain the merchant API documentation and credentials first.');
  }
  async handleWebhook(): Promise<WebhookOutcome> {
    throw new Error('WhishPayProvider webhook handling is not implemented.');
  }
}
