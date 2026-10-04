import { DomainError } from "@/contracts/common"
import { ZodError, type ZodType } from "zod"
import { ChatError } from "./services/chat"
import { BookingError, type BookingErrorCode } from "./services/booking"
import { OllamaHttpError } from "@/llm/ollama"
import { logEvent } from "./log"

const STATUS: Record<BookingErrorCode | "not_bookable" | "bad_request", number> = {
  invalid: 400,
  bad_request: 400,
  not_bookable: 400,
  not_found: 404,
  forbidden: 403,
  slot_unavailable: 409,
  overlapping_request: 409,
  not_pending: 409,
  expired: 409,
}

export function fail(code: keyof typeof STATUS, message: string): Response {
  return Response.json({ code, message }, { status: STATUS[code] })
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new BookingError("invalid", "요청 본문이 올바른 JSON이 아니에요")
  }
  return schema.parse(raw)
}

/** Maps domain errors to `{ code, message }` responses. Anything else is a 500 without details. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof DomainError) return Response.json({ code: e.code, message: e.message }, {status: e.code === "unauthenticated" ? 401 : e.code === "csrf_failed" || e.code === "forbidden" ? 403 : 409})
    if (e instanceof BookingError || e instanceof ChatError) {
      logEvent("api.rejected", { code: e.code })
      return fail(e.code, e.message)
    }
    if (e instanceof ZodError) return fail("bad_request", e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "))
    if (e instanceof OllamaHttpError) {
      logEvent("api.llm_error", { status: e.status })
      return Response.json({ code: "llm_unavailable", message: "AI 응답을 받지 못했어요" }, { status: 502 })
    }
    logEvent("api.internal_error", {})
    return Response.json({ code: "internal", message: "서버 오류가 발생했어요" }, { status: 500 })
  }
}

export type Ctx<P extends Record<string, string>> = { params: Promise<P> }
