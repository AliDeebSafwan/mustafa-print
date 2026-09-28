/** Stable id of this browser profile, sent with every sync push so conflicts can be traced to a device. */
export function getDeviceId(): string {
  const key = 'mpe.deviceId'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

/** Ask the browser not to evict IndexedDB under storage pressure (iOS/Safari may otherwise clear unsynced work). */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !navigator.storage.persist) return false
  return (await navigator.storage.persisted()) || (await navigator.storage.persist())
}
