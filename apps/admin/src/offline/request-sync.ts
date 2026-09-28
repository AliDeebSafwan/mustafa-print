import { syncDeps } from './deps'
import { syncNow } from './sync'

/** After a local change: send it right away when online. Offline, the automatic triggers pick it up later. */
export function requestSync(): void {
  if (typeof navigator === 'undefined' || navigator.onLine) void syncNow(syncDeps)
}
