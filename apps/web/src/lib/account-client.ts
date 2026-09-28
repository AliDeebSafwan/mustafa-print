import type { CustomerMe, CustomerOrderSummary, ReorderItem, WebOrderInput, WebOrderPlaced } from "@mpe/shared";

/** The browser side of the customer account: same-origin calls, so the httpOnly session cookie travels by itself. */
export type AccountErrorCode =
  | "invalid_credentials" | "too_many_attempts" | "invalid_token" | "invalid_request" | "unauthorized" | "email_not_verified" | "offline" | "server";
export class AccountError extends Error {
  readonly code: AccountErrorCode;
  /** The server's detail string, e.g. "below_minimum:500.000" — the checkout screen turns this into plain text. */
  readonly detail?: string;
  constructor(code: AccountErrorCode, detail?: string) { super(detail ?? code); this.name = "AccountError"; this.code = code; this.detail = detail; }
}

const KNOWN: AccountErrorCode[] = ["invalid_credentials", "too_many_attempts", "invalid_token", "invalid_request", "unauthorized", "email_not_verified"];

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api/v1/public/account${path}`, {
      method, credentials: "same-origin",
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new AccountError("offline");
  }
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new AccountError(KNOWN.includes(payload?.error as AccountErrorCode) ? (payload!.error as AccountErrorCode) : "server", payload?.message);
  return payload as T;
}

export const account = {
  /** null when nobody is signed in. */
  me: () => call<CustomerMe>("GET", "/me").catch((err: unknown) => { if (err instanceof AccountError && err.code === "unauthorized") return null; throw err; }),
  orders: () => call<CustomerOrderSummary[]>("GET", "/orders"),
  reorderItems: (code: string) => call<ReorderItem[]>("GET", `/orders/${encodeURIComponent(code)}/reorder`),
  signup: (data: { email: string; password: string; full_name: string; phone_e164?: string | null; locale: "ar" | "en" }) => call<{ status: string }>("POST", "/signup", data),
  login: (email: string, password: string) => call<CustomerMe>("POST", "/login", { email, password }),
  logout: () => call<void>("POST", "/logout"),
  verify: (token: string) => call<CustomerMe>("POST", "/verify", { token }),
  resendVerification: (email: string) => call<{ status: string }>("POST", "/verify/resend", { email }),
  forgot: (email: string) => call<{ status: string }>("POST", "/password/forgot", { email }),
  reset: (token: string, password: string) => call<CustomerMe>("POST", "/password/reset", { token, password }),
  uploadDesign: (file: File) => { const form = new FormData(); form.append("file", file, file.name); return call<{ id: string; original_name: string }>("POST", "/files", form); },
  placeOrder: (data: WebOrderInput) => call<WebOrderPlaced>("POST", "/orders", data),
};
