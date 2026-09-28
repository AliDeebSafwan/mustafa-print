/**
 * Payment provider abstraction. COD needs no provider (staff record the cash collected and settle it
 * later). Online payments go through a provider implementing this interface.
 */
export interface CheckoutRequest {
  orderId: string;
  orderNumber: string;
  amount: string;        // decimal string, e.g. "25.50"
  currency: string;      // ISO 4217, "USD"
  returnUrl: string;
  callbackUrl: string;   // our webhook
}

export interface CheckoutSession {
  providerTxnId: string;
  redirectUrl: string;
}

export type WebhookOutcome =
  | { kind: 'payment'; providerTxnId: string; status: 'completed' | 'failed' | 'cancelled'; amount?: string; raw: unknown }
  | { kind: 'ignored' };

export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Must verify authenticity (signature / secret) and throw on anything suspicious. */
  handleWebhook(headers?: Record<string, string | string[] | undefined>, rawBody?: Buffer): Promise<WebhookOutcome>;
}
