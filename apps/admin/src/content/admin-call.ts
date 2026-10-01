import { auth } from '../auth'
import { API_URL } from '../lib/config'
import { createCall, type ApiCall } from './call'

/** The staff app's own calls: this browser's API address and the signed-in session. */
export const adminCall = (basePath: string): ApiCall => createCall(basePath, { baseUrl: API_URL, getToken: () => auth.getAccessToken() })
