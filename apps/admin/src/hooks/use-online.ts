import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}

/** navigator.onLine only says "a network interface is up"; the sync engine is the real source of truth for reachability. */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
