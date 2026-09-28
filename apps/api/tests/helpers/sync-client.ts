import { generatePublicCode, pullResponseSchema, pushResponseSchema, uuidv7, type Mutation, type MutationInput, type MutationKind, type MutationResult, type PullResponse } from '@mpe/shared';
import type { ApiClient } from './test-server';

/** Typed: the payload must satisfy the shared contract for that kind, exactly like in the staff app. */
export function mutation<K extends MutationKind>(kind: K, entityId: string, payload: MutationInput<K>, id: string = uuidv7()): Mutation {
  const [entity, op] = kind.split(':') as [Mutation['entity'], Mutation['op']];
  return { id, entity, entityId, op, baseVersion: null, payload: payload as Record<string, unknown>, clientCreatedAt: new Date().toISOString() };
}

export async function push(api: ApiClient, mutations: Mutation[], deviceId = 'device-test-0001'): Promise<MutationResult[]> {
  const res = await api.post('/api/v1/sync/push', { deviceId, mutations });
  if (res.status !== 200) throw new Error(`push failed: ${res.status} ${await res.text()}`);
  // Parsed with the SAME schema the staff app uses: if the server's answer ever stops matching it, the app would treat it as a server error.
  return pushResponseSchema.parse(await res.json()).results;
}

/** Pushes one mutation and returns its verdict. */
export async function pushOne(api: ApiClient, m: Mutation, deviceId?: string): Promise<MutationResult> {
  const [result] = await push(api, [m], deviceId);
  return result!;
}

export async function pull(api: ApiClient, cursor?: string, limit = 200): Promise<PullResponse> {
  const qs = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
  const res = await api.get(`/api/v1/sync/pull?${qs}`);
  if (res.status !== 200) throw new Error(`pull failed: ${res.status} ${await res.text()}`);
  return pullResponseSchema.parse(await res.json());
}

/** Follows hasMore until the server has nothing left. */
export async function pullAll(api: ApiClient, cursor?: string, limit = 200): Promise<{ changes: Record<string, Record<string, unknown>[]>; cursor: string; pages: number }> {
  const changes: Record<string, Record<string, unknown>[]> = {};
  let pages = 0;
  for (let next = cursor; ; ) {
    const page = await pull(api, next, limit);
    pages++;
    for (const [entity, rows] of Object.entries(page.changes)) (changes[entity] ??= []).push(...(rows ?? []));
    next = page.cursor;
    if (!page.hasMore) return { changes, cursor: next, pages };
  }
}

export const newId = uuidv7;
export const newCode = generatePublicCode;

export const customerPayload = (over: Partial<MutationInput<'customers:insert'>> = {}): MutationInput<'customers:insert'> => ({
  full_name: 'Ali Hassan', phone_e164: `+9617${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, locale: 'ar',
  whatsapp_opt_in: true, preferred_channel: 'whatsapp', consent_source: 'in_person', ...over,
});

export const orderPayload = (customerId: string, over: Partial<MutationInput<'orders:insert'>> = {}): MutationInput<'orders:insert'> => ({
  public_code: newCode(), customer_id: customerId,
  items: [{ id: newId(), name_snapshot: 'Business cards 500 pcs', quantity: 1, unit_price: '25' }], ...over,
});

/** Creates a customer through the API and returns its id. */
export async function createCustomer(api: ApiClient, over?: Partial<MutationInput<'customers:insert'>>): Promise<string> {
  const id = newId();
  const r = await pushOne(api, mutation('customers:insert', id, customerPayload(over)));
  if (r.result !== 'applied') throw new Error(`createCustomer failed: ${JSON.stringify(r)}`);
  return id;
}

/** Creates an order through the API and returns its id and tracking code. */
export async function createOrder(api: ApiClient, customerId: string, over?: Partial<MutationInput<'orders:insert'>>): Promise<{ id: string; code: string }> {
  const id = newId();
  const payload = orderPayload(customerId, over);
  const r = await pushOne(api, mutation('orders:insert', id, payload));
  if (r.result !== 'applied') throw new Error(`createOrder failed: ${JSON.stringify(r)}`);
  return { id, code: payload.public_code };
}
