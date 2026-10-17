import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { DomainError } from "@/contracts/common"
import type { Db } from "@/server/db/client"
import { all, lock, one, run } from "@/server/db/sql"
import type { ServiceContext } from "@/server/runtime"

export const WELCOME_TEXT = "Welcome to Find Me a Time! Please reply to this message so that I know I've reached you."
export const CONNECTION_TTL_MS = 30 * 60_000
export const RETRY_COOLDOWN_MS = 60_000
export const MAX_ATTEMPTS = 3
const STALE_SEND_MS = 5 * 60_000
const E164 = /^\+[1-9]\d{7,14}$/

export type ConnectionStatus = "pending" | "sent" | "failed" | "uncertain" | "connected" | "expired"
type ConnectionRow = {
  id: string; host_id: string; phone_e164: string; status: ConnectionStatus; space_id: string | null; line_id: string | null;
  created_at: number; expires_at: number; updated_at: number; failure_category: string | null;
}
export type SafeConnection = {
  id: string; phone: string; status: ConnectionStatus; createdAt: number; expiresAt: number;
  failure: string | null; retryEligibleAt: number | null; attempts: number;
}

function masked(phone: string) { return `${phone.slice(0, 3)}••••${phone.slice(-2)}` }
function safeFailure(value: unknown): string {
  const message = value instanceof Error ? value.message.toLowerCase() : ""
  if (message.includes("non_imessage") || message.includes("sms") || message.includes("rcs") || message.includes("service")) return "non_imessage_recipient"
  if (message.includes("auth") || message.includes("credential")) return "provider_authentication"
  return "provider_rejected"
}

async function expireConnections(db: Db, now: number, hostId?: string) {
  await run(db, `UPDATE host_phone_connections SET status='expired',updated_at=?,revision=revision+1
    WHERE status IN ('pending','sent','failed','uncertain') AND expires_at<=? ${hostId ? "AND host_id=?" : ""}`,
    hostId ? [now, now, hostId] : [now, now])
}

async function safeStatus(db: Db, row: ConnectionRow, now: number): Promise<SafeConnection> {
  const attemptRows = await all<{ attempt_no: number; status: string; updated_at: number }>(db,
    "SELECT attempt_no,status,updated_at FROM photon_outbound_attempts WHERE connection_id=? ORDER BY attempt_no", [row.id])
  const last = attemptRows.at(-1)
  const eligibleAt = row.status === "failed" && attemptRows.length < MAX_ATTEMPTS && last?.status === "failed"
    ? last.updated_at + RETRY_COOLDOWN_MS : null
  return { id: row.id, phone: masked(row.phone_e164), status: row.status, createdAt: row.created_at, expiresAt: row.expires_at,
    failure: row.failure_category, retryEligibleAt: eligibleAt && eligibleAt <= now ? now : eligibleAt, attempts: attemptRows.length }
}

export async function startConnection(ctx: ServiceContext, hostId: string, input: string): Promise<SafeConnection> {
  if (ctx.config.mode !== "real") throw new DomainError("forbidden", "실제 로그인한 호스트만 전화번호를 연결할 수 있어요")
  const phone = input.trim()
  if (!E164.test(phone)) throw new DomainError("invalid_input", "국가 코드를 포함한 E.164 전화번호를 입력해 주세요")
  const now = ctx.clock.now()
  return ctx.db.transaction(async (tx) => {
    await lock(tx, `imessage-host:${hostId}`, `imessage-phone:${phone}`)
    await expireConnections(tx, now)
    const own = await one<ConnectionRow>(tx, "SELECT * FROM host_phone_connections WHERE host_id=? AND status IN ('pending','sent','failed','uncertain','connected')", [hostId])
    if (own) {
      if (own.phone_e164 !== phone) throw new DomainError("revision_conflict", "이미 연결 중이거나 연결된 번호가 있어요")
      return safeStatus(tx, own, now)
    }
    const collision = await one<{ id: string }>(tx, "SELECT id FROM host_phone_connections WHERE phone_e164=? AND status IN ('pending','sent','failed','uncertain','connected')", [phone])
    if (collision) throw new DomainError("revision_conflict", "이 번호는 사용할 수 없어요")
    const id = ctx.id(), attemptId = ctx.id()
    await run(tx, `INSERT INTO host_phone_connections(id,host_id,phone_e164,status,created_at,expires_at,updated_at)
      VALUES(?,?,?,'pending',?,?,?)`, [id, hostId, phone, now, now + CONNECTION_TTL_MS, now])
    await run(tx, `INSERT INTO photon_outbound_attempts(id,connection_id,attempt_no,status,purpose,created_at,updated_at,available_at)
      VALUES(?,?,1,'queued','welcome',?,?,?)`, [attemptId, id, now, now, now])
    const row = (await one<ConnectionRow>(tx, "SELECT * FROM host_phone_connections WHERE id=?", [id]))!
    return safeStatus(tx, row, now)
  })
}

export async function getConnection(ctx: ServiceContext, hostId: string): Promise<SafeConnection | null> {
  if (ctx.config.mode !== "real") throw new DomainError("forbidden", "실제 로그인한 호스트만 전화번호 연결을 조회할 수 있어요")
  const now = ctx.clock.now()
  await expireConnections(ctx.db, now, hostId)
  const row = await one<ConnectionRow>(ctx.db, "SELECT * FROM host_phone_connections WHERE host_id=? ORDER BY created_at DESC LIMIT 1", [hostId])
  return row ? safeStatus(ctx.db, row, now) : null
}

export async function retryConnection(ctx: ServiceContext, hostId: string): Promise<SafeConnection> {
  if (ctx.config.mode !== "real") throw new DomainError("forbidden", "실제 로그인한 호스트만 문자 발송을 재시도할 수 있어요")
  const now = ctx.clock.now()
  return ctx.db.transaction(async (tx) => {
    await lock(tx, `imessage-host:${hostId}`)
    await expireConnections(tx, now, hostId)
    const row = await one<ConnectionRow>(tx, "SELECT * FROM host_phone_connections WHERE host_id=? AND status IN ('pending','sent','failed','uncertain','connected')", [hostId])
    if (!row) throw new DomainError("not_found", "연결할 전화번호가 없어요")
    const attempts = await all<{ attempt_no: number; status: string; updated_at: number }>(tx,
      "SELECT attempt_no,status,updated_at FROM photon_outbound_attempts WHERE connection_id=? ORDER BY attempt_no", [row.id])
    const last = attempts.at(-1)
    if (row.status !== "failed" || !last || last.status !== "failed" || attempts.length >= MAX_ATTEMPTS || now < last.updated_at + RETRY_COOLDOWN_MS) {
      return safeStatus(tx, row, now)
    }
    await run(tx, `INSERT INTO photon_outbound_attempts(id,connection_id,attempt_no,status,purpose,created_at,updated_at,available_at)
      VALUES(?,?,?,'queued','welcome',?,?,?)`, [ctx.id(), row.id, attempts.length + 1, now, now, now])
    await run(tx, "UPDATE host_phone_connections SET status='pending',failure_category=NULL,updated_at=?,revision=revision+1 WHERE id=?", [now, row.id])
    const updated = (await one<ConnectionRow>(tx, "SELECT * FROM host_phone_connections WHERE id=?", [row.id]))!
    return safeStatus(tx, updated, now)
  })
}

export type PhotonInbound = {
  webhookId: string; eventType: string; messageId: string; platform: string | null; direction: string | null;
  senderId: string | null; spaceId: string | null; spaceType: string | null; lineId: string | null;
  contentType: string | null; body: string | null; messageAt: number | null;
}

export async function storeInbound(db: Db, event: PhotonInbound, receivedAt: number) {
  return db.transaction(async (tx) => {
    const inserted = await all<{ message_id: string }>(tx, `INSERT INTO photon_inbound_events(
      webhook_id,message_id,event_type,platform,direction,sender_id,space_id,space_type,line_id,content_type,body,message_at,received_at,status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(webhook_id,message_id) DO NOTHING RETURNING message_id`, [
      event.webhookId,event.messageId,event.eventType,event.platform,event.direction,event.senderId,event.spaceId,event.spaceType,event.lineId,
      event.contentType,event.body,event.messageAt,receivedAt,event.eventType === "messages" && event.direction === "inbound" && event.contentType === "text" ? "pending" : "ignored",
    ])
    return inserted.length > 0
  })
}

export async function processInboundBatch(db: Db, now: number, max = 20): Promise<number> {
  return db.transaction(async (tx) => {
    const events = await all<PhotonInbound & { status: string }>(tx, `SELECT webhook_id AS "webhookId",event_type AS "eventType",message_id AS "messageId",
      platform,direction,sender_id AS "senderId",space_id AS "spaceId",space_type AS "spaceType",line_id AS "lineId",
      content_type AS "contentType",body,message_at AS "messageAt",status FROM photon_inbound_events
      WHERE status IN ('pending','failed') ORDER BY received_at LIMIT ? FOR UPDATE SKIP LOCKED`, [max])
    for (const event of events) {
      await run(tx, "UPDATE photon_inbound_events SET status='processing' WHERE webhook_id=? AND message_id=?", [event.webhookId,event.messageId])
      const eligible = event.eventType === "messages" && event.platform === "iMessage" && event.direction === "inbound" &&
        event.contentType === "text" && !!event.body?.trim() && !!event.senderId && E164.test(event.senderId) &&
        !!event.spaceId && event.spaceType === "dm" && !!event.lineId
      if (!eligible) {
        await run(tx, "UPDATE photon_inbound_events SET body=NULL,status='ignored',processed_at=? WHERE webhook_id=? AND message_id=?", [now,event.webhookId,event.messageId])
        continue
      }
      const connection = await one<ConnectionRow>(tx, `SELECT * FROM host_phone_connections WHERE phone_e164=? AND status IN ('pending','sent','uncertain','connected')
        AND (status='connected' OR expires_at>?) AND space_id=? AND line_id=? FOR UPDATE`, [event.senderId,event.messageAt ?? now,event.spaceId,event.lineId])
      if (!connection) {
        await run(tx, "UPDATE photon_inbound_events SET body=NULL,status='ignored',processed_at=? WHERE webhook_id=? AND message_id=?", [now,event.webhookId,event.messageId])
        continue
      }
      if (connection.status !== "connected") {
        await run(tx, "UPDATE host_phone_connections SET status='connected',failure_category=NULL,updated_at=?,revision=revision+1 WHERE id=? AND status IN ('pending','sent','uncertain')", [now,connection.id])
      }
      await run(tx, `INSERT INTO host_imessage_messages(id,host_id,connection_id,conversation_id,direction,message_id,body,created_at)
        VALUES(?,?,?,?,'inbound',?,?,?) ON CONFLICT(connection_id,message_id) DO NOTHING`,
        [randomUUID(),connection.host_id,connection.id,event.spaceId,event.messageId,event.body,event.messageAt ?? now])
      await run(tx, "UPDATE photon_inbound_events SET body=NULL,status='processed',processed_at=? WHERE webhook_id=? AND message_id=?", [now,event.webhookId,event.messageId])
    }
    return events.length
  })
}

export interface PhotonTransport {
  open(phone: string, requestedLine?: string): Promise<{ conversationId: string; lineId: string; recipientService: string }>
  send(phone: string, conversationId: string, lineId: string, text: string): Promise<{ messageId?: string }>
  close?(): Promise<void>
}

export async function processOutboundOne(ctx: ServiceContext, transport: PhotonTransport): Promise<boolean> {
  const now = ctx.clock.now()
  const attempt = await ctx.db.transaction(async (tx) => {
    await run(tx, `UPDATE photon_outbound_attempts SET status='uncertain',failure_category='worker_interrupted',updated_at=?
      WHERE status='sending' AND updated_at<=?`, [now,now-STALE_SEND_MS])
    await run(tx, `UPDATE host_phone_connections c SET status='uncertain',failure_category='worker_interrupted',updated_at=?,revision=revision+1
      FROM photon_outbound_attempts a WHERE a.connection_id=c.id AND a.status='uncertain' AND a.failure_category='worker_interrupted'
      AND c.status IN ('pending','failed')`, [now])
    const row = await one<any>(tx, `SELECT a.id AS attempt_id,a.connection_id,a.attempt_no,c.host_id,c.phone_e164,c.expires_at
      FROM photon_outbound_attempts a JOIN host_phone_connections c ON c.id=a.connection_id
      WHERE a.status='queued' AND a.available_at<=? AND c.status='pending' AND c.expires_at>?
      ORDER BY a.available_at,a.created_at LIMIT 1 FOR UPDATE OF a SKIP LOCKED`, [now,now])
    if (!row) return null
    await run(tx, "UPDATE photon_outbound_attempts SET status='sending',updated_at=? WHERE id=? AND status='queued'", [now,row.attempt_id])
    return row as { attempt_id: string; connection_id: string; attempt_no: number; host_id: string; phone_e164: string; expires_at: number }
  })
  if (!attempt) return false

  let conversationId = "", lineId = "", sendStarted = false
  try {
    const opened = await transport.open(attempt.phone_e164, ctx.config.spectrumImessageLine)
    if (opened.recipientService !== "unknown" && opened.recipientService !== "iMessage") throw new Error("non_imessage_recipient")
    conversationId = opened.conversationId
    lineId = opened.lineId
    if (!conversationId || !lineId) throw new Error("invalid_routing")
    await run(ctx.db, `UPDATE host_phone_connections SET space_id=?,line_id=?,updated_at=?,revision=revision+1
      WHERE id=? AND status='pending'`, [conversationId,lineId,ctx.clock.now(),attempt.connection_id])
    sendStarted = true
    const sent = await transport.send(attempt.phone_e164,conversationId,lineId,WELCOME_TEXT)
    const completedAt = ctx.clock.now()
    await ctx.db.transaction(async (tx) => {
      await run(tx, `UPDATE photon_outbound_attempts SET status='sent',provider_message_id=?,failure_category=NULL,updated_at=? WHERE id=? AND status='sending'`,
        [sent.messageId ?? null,completedAt,attempt.attempt_id])
      await run(tx, "UPDATE host_phone_connections SET status='sent',failure_category=NULL,updated_at=?,revision=revision+1 WHERE id=? AND status='pending'", [completedAt,attempt.connection_id])
      await run(tx, `INSERT INTO host_imessage_messages(id,host_id,connection_id,conversation_id,direction,message_id,body,created_at)
        VALUES(?,?,?,?,'outbound',?,?,?) ON CONFLICT(connection_id,message_id) DO NOTHING`,
        [randomUUID(),attempt.host_id,attempt.connection_id,conversationId,sent.messageId ?? attempt.attempt_id,WELCOME_TEXT,completedAt])
    })
  } catch (error) {
    const failedAt = ctx.clock.now(), uncertain = sendStarted
    const category = safeFailure(error)
    await ctx.db.transaction(async (tx) => {
      await run(tx, `UPDATE photon_outbound_attempts SET status=?,failure_category=?,updated_at=? WHERE id=? AND status='sending'`,
        [uncertain ? "uncertain" : "failed",uncertain ? "send_outcome_unknown" : category,failedAt,attempt.attempt_id])
      await run(tx, `UPDATE host_phone_connections SET status=?,failure_category=?,updated_at=?,revision=revision+1
        WHERE id=? AND status='pending'`, [uncertain ? "uncertain" : "failed",uncertain ? "send_outcome_unknown" : category,failedAt,attempt.connection_id])
    })
  }
  return true
}

export function verifyPhotonSignature(rawBody: Uint8Array, secret: string, signature: string | null, timestamp: string | null, nowMs = Date.now()): boolean {
  if (!secret || !signature || !timestamp || !/^\d+$/.test(timestamp)) return false
  if (!signature.startsWith("v0=")) return false
  const seconds = Number(timestamp)
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(nowMs / 1000) - seconds) > 300) return false
  const expected = `v0=${createHmac("sha256",secret).update(`v0:${timestamp}:`).update(rawBody).digest("hex")}`
  const actualBytes = Buffer.from(signature), expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes,expectedBytes)
}

export function normalizePhotonPayload(payload: unknown, webhookId: string, eventHeader: string | null): PhotonInbound | null {
  if (!payload || typeof payload !== "object") return null
  const root = payload as Record<string, any>
  if (typeof root.event !== "string" || root.event !== eventHeader || !root.message || typeof root.message !== "object") return null
  const msg = root.message, space = msg.space ?? root.space, sender = msg.sender, content = msg.content
  if (typeof msg.id !== "string" || !msg.id.trim() || !space || typeof space !== "object" || typeof space.id !== "string" || !space.id.trim()) return null
  const time = typeof msg.timestamp === "string" ? Date.parse(msg.timestamp) : NaN
  if (!Number.isFinite(time)) return null
  return {
    webhookId,eventType:root.event,messageId:msg.id,
    platform:typeof msg.platform === "string" ? msg.platform : typeof space.platform === "string" ? space.platform : null,
    direction:typeof msg.direction === "string" ? msg.direction : null,
    senderId:sender && typeof sender.id === "string" ? sender.id : null,
    spaceId:space.id,spaceType:typeof space.type === "string" ? space.type : null,
    lineId:typeof space.phone === "string" ? space.phone : null,
    contentType:content && typeof content.type === "string" ? content.type : null,
    body:content?.type === "text" && typeof content.text === "string" ? content.text : null,
    messageAt:Number.isFinite(time) ? time : null,
  }
}

export async function getMessageHistory(db: Db, hostId: string, limit = 100) {
  return all(db, `SELECT m.message_id AS "messageId",m.conversation_id AS "conversationId",m.direction,m.body,m.created_at AS "createdAt"
    FROM host_imessage_messages m WHERE m.host_id=? ORDER BY m.created_at,m.id LIMIT ?`, [hostId,Math.max(1,Math.min(200,limit))])
}
