import { auth } from '../auth'
import { getDeviceId } from '../lib/device'
import { API_URL } from '../lib/config'
import type { SyncDeps } from './sync'

export const syncDeps: SyncDeps = {
  baseUrl: API_URL,
  deviceId: getDeviceId(),
  getToken: () => auth.getAccessToken(),
}
