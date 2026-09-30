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
