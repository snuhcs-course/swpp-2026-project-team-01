import { createClient } from '@supabase/supabase-js'
import type { ApiError } from '../../../../packages/contracts/index'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const apiOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? '/api'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url!, key!, { auth: { detectSessionInUrl: true, flowType: 'pkce' } }) : null

export class ServiceError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

export async function api<T>(path: string, options: { body?: unknown; token?: string; idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<T> {
  if (!configured) throw new ServiceError('CONFIGURATION', 'The scheduling service is being configured. Please try again later.')
  const headers: Record<string, string> = { apikey: key!, 'Content-Type': 'application/json' }
  if (options.token) headers['X-Request-Token'] = options.token
  else {
    const { data } = await supabase!.auth.getSession()
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  }
  if (options.body !== undefined) headers['Idempotency-Key'] = options.idempotencyKey ?? crypto.randomUUID()
  const response = await fetch(`${apiOrigin}${path}`, { method: options.body === undefined ? 'GET' : 'POST', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: 'include', signal: options.signal })
  const result = await response.json().catch(() => null) as T | ApiError | null
  if (!response.ok) {
    const error = result && typeof result === 'object' && 'error' in result ? result.error : null
    throw new ServiceError(error?.code ?? 'SERVICE_ERROR', error?.message ?? 'The service could not complete this action. Please try again.')
  }
  return result as T
}

export function requestToken(id: string): string | undefined { return localStorage.getItem(`fmat-request:${id}`) ?? undefined }
export function rememberRequest(id: string, token: string) { localStorage.setItem(`fmat-request:${id}`, token) }
