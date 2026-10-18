import { ensureBound, getDb } from "@/server/db/client"
import { readServerConfig } from "@/server/config"
import { normalizePhotonPayload, storeInbound, verifyPhotonSignature } from "@/server/services/imessage"
import { logEvent } from "@/server/log"

export const runtime = "nodejs"
const MAX_BODY_BYTES = 64 * 1024

async function readLimitedBody(request: Request): Promise<Uint8Array | null> {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

export async function POST(request: Request): Promise<Response> {
  const config = readServerConfig()
  const webhookId = request.headers.get("x-spectrum-webhook-id")
  const timestamp = request.headers.get("x-spectrum-timestamp")
  const signature = request.headers.get("x-spectrum-signature")
  const eventHeader = request.headers.get("x-spectrum-event")
  if (!config.spectrumWebhookId || !config.spectrumWebhookSecret) return Response.json({ error: "webhook_unavailable" }, { status: 503 })
  if (!webhookId || webhookId !== config.spectrumWebhookId || !eventHeader || !timestamp || !signature) {
    return Response.json({ error: "invalid_webhook" }, { status: 400 })
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: "payload_too_large" }, { status: 413 })
  const rawBody = await readLimitedBody(request)
  if (!rawBody) return Response.json({ error: "payload_too_large" }, { status: 413 })
  if (!verifyPhotonSignature(rawBody, config.spectrumWebhookSecret, signature, timestamp)) {
    logEvent("imessage.webhook_rejected", { reason: "signature" })
    return Response.json({ error: "invalid_webhook" }, { status: 401 })
  }
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)) }
  catch { return Response.json({ error: "invalid_webhook" }, { status: 400 }) }
  if (payload && typeof payload === "object" && (payload as Record<string, unknown>).event !== "messages") {
    if ((payload as Record<string, unknown>).event === eventHeader) return Response.json({ ok: true, ignored: true })
    return Response.json({ error: "invalid_webhook" }, { status: 400 })
  }
  const event = normalizePhotonPayload(payload, webhookId, eventHeader)
  if (!event) return Response.json({ error: "invalid_webhook" }, { status: 400 })
  try {
    const db = getDb()
    await ensureBound(db, "real")
    const inserted = await storeInbound(db, event, Date.now())
    return Response.json({ ok: true, duplicate: !inserted })
  } catch {
    logEvent("imessage.webhook_persistence_failed", {})
    return Response.json({ error: "temporarily_unavailable" }, { status: 503 })
  }
}
