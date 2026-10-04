export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T
  error: string | null
}

/** JSON request helper. Never throws: network failures come back as `ok: false`. */
export async function call<T = Record<string, unknown>>(method: string, url: string, payload?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const data = (await res.json().catch(() => ({}))) as T & { message?: string }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data.message ?? `요청에 실패했어요 (${res.status})`) }
  } catch {
    return { ok: false, status: 0, data: {} as T, error: "서버에 연결하지 못했어요" }
  }
}

// The legacy `call` API above remains available to the existing screens.
import { z } from 'zod'
import { errorCodeSchema, type ApiResult as Envelope } from '@/contracts/common'
import { operationViewSchema } from '@/contracts/operations'

const failureSchema = z.object({ ok: z.literal(false), error: z.object({ code: errorCodeSchema, message: z.string(), retryable: z.boolean(), fieldErrors: z.record(z.string(), z.array(z.string())).optional(), currentRevision: z.number().optional() }), meta: z.object({ operationId: z.string().optional(), outcome: z.enum(['not_applied', 'pending', 'unknown']) }) })
export type Command<T> = { method: string; url: string; kind: string; payload: unknown; schema: z.ZodType<T> }
export async function request<T>(method: string, url: string, schema: z.ZodType<T>, payload?: unknown, key?: string): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, { method, cache: 'no-store', headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) })
    const body: unknown = await res.json()
    const failure = failureSchema.safeParse(body)
    if (failure.success) return failure.data
    const success = z.object({ ok: z.literal(true), data: schema, meta: z.object({ operationId: z.string().optional(), revision: z.number().optional() }) }).safeParse(body)
    if (res.ok && success.success) return success.data
  } catch { /* Transport and malformed JSON cannot prove that a mutation failed. */ }
  return { ok: false, error: { code: 'internal_error', message: '서버 응답을 확인하지 못했어요. 결과를 확인해 주세요.', retryable: true }, meta: { outcome: 'unknown' } }
}
export function readOperation(kind: string, key: string, id?: string) {
  return request('GET', id ? `/api/operations/${encodeURIComponent(id)}` : `/api/operations?kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(key)}`, operationViewSchema)
}
