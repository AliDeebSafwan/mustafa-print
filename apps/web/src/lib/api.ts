import "server-only";

export interface TrackedOrder {
  order: {
    order_number: string | null;
    status: string;
    fulfillment_type: "pickup" | "delivery";
    payment_status: "unpaid" | "partial" | "paid" | "refunded";
    total: string;
    currency: string;
    delivery_fee_pending: boolean;
    placed_at: string;
    branch_name_ar: string;
    branch_name_en: string;
  };
  timeline: { status: string; occurred_at: string }[];
  items: { name: string; quantity: string; unit: string }[];
}

const base = () => process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Returns null when the code does not exist. Never cached: status changes minute by minute. */
export async function fetchTrackedOrder(code: string): Promise<TrackedOrder | null> {
  const res = await fetch(`${base()}/api/v1/public/orders/${encodeURIComponent(code)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  return (await res.json()) as TrackedOrder;
}

/** A quote by its link code; null when it does not exist. Never cached: it can be accepted or expire at any moment. */
export async function fetchQuote(code: string): Promise<import("@mpe/shared").PublicQuote | null> {
  const res = await fetch(`${base()}/api/v1/public/quotes/${encodeURIComponent(code)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`quote lookup failed: ${res.status}`);
  return res.json();
}

export interface PublicProof {
  version: number; kind: "pdf" | "jpg" | "png"; status: "pending" | "approved" | "changes_requested" | "superseded"; created_at: string;
  order_number: string | null; order_code: string; shop_name_ar: string; shop_name_en: string; isLatest: boolean;
  responses: { decision: "approved" | "changes_requested"; comment: string | null; responded_at: string }[];
}

/** A proof by its link code; null when it does not exist. Never cached: the customer's answer changes it. */
export async function fetchProof(code: string): Promise<PublicProof | null> {
  const res = await fetch(`${base()}/api/v1/public/proofs/${encodeURIComponent(code)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`proof lookup failed: ${res.status}`);
  return res.json();
}
