import { adminCall } from './admin-call'

const call = adminCall('/api/v1/admin/push')

export const pushApi = {
  vapidPublicKey: () => call<{ publicKey: string | null }>('GET', '/vapid-public-key'),
  subscribe: (sub: PushSubscriptionJSON) => call<void>('POST', '/subscribe', sub),
  unsubscribe: (endpoint: string) => call<void>('POST', '/unsubscribe', { endpoint }),
}
