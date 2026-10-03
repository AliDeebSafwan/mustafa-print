import { adminApi } from './call'

const { call } = adminApi('push')

export const pushApi = {
  vapidPublicKey: () => call<{ publicKey: string | null }>('GET', '/vapid-public-key'),
  subscribe: (sub: PushSubscriptionJSON) => call<void>('POST', '/subscribe', sub),
  unsubscribe: (endpoint: string) => call<void>('POST', '/unsubscribe', { endpoint }),
}
