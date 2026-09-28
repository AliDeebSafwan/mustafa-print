import { useSyncExternalStore } from 'react'
import { hasPermission, type Permission, type SessionBranch } from '@mpe/shared'
import { API_URL } from '../lib/config'
import { createAuthClient, type AuthState } from './auth-client'

export const auth = createAuthClient({ baseUrl: API_URL })

export const useAuth = (): AuthState => useSyncExternalStore(auth.subscribe, auth.getState)

/** What the signed-in user may do. The server enforces the same rules; this only decides what to show. */
export function useCan(): (permission: Permission) => boolean {
  const state = useAuth()
  return (permission) => state.status === 'signed_in' && hasPermission(state.user.permissions, permission)
}

/** The branch this device is signed in to, with the rules the shop set (currency, discount limit). */
export function useBranch(): SessionBranch | null {
  const state = useAuth()
  return state.status === 'signed_in' ? state.branch : null
}
