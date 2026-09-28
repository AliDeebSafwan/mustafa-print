/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { NavigationRoute, registerRoute } from 'workbox-routing'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'

// Exactly what the generated service worker did before: cache the app shell, fall back to it for any navigation
// (this is a single-page app), and drop caches from a previous build once the new one takes over.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

interface OrderAlertPayload { title: string; body: string; url: string }

/** A new web order, even with the app closed. The payload is written by the server (modules/push/push.service.ts)
 *  and is not secret — it names an order, nothing sensitive — but is only ever sent to a device that subscribed. */
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: OrderAlertPayload
  try {
    payload = event.data.json()
  } catch {
    return   // an unrecognised payload is never shown as a blank, confusing notification
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body, icon: '/pwa-192.png', badge: '/pwa-192.png', data: { url: payload.url }, tag: payload.url,
  }))
})

/** Focuses an already-open tab on the order if there is one, rather than always opening a new one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = clientsList.find((c) => new URL(c.url).pathname === url)
    if (existing) return existing.focus()
    return self.clients.openWindow(url)
  })())
})
