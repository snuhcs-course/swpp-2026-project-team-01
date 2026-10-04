import { createHash, randomBytes, randomUUID } from "node:crypto"
import { cookies } from "next/headers"
import { DomainError } from "@/contracts/common"
import type { Actor } from "@/contracts/auth"
import { ensureBound, getDb, one, run, type Db } from "./db/client"
import { readServerConfig } from "./config"

export const SESSION_COOKIE = "mvp_session"
export const USER_COOKIE = "uid"
export const OAUTH_COOKIE = "mvp_oauth"
export const SESSION_TTL_MS = 7 * 86400000
export const OAUTH_TTL_MS = 10 * 60000
export interface SessionContext { db: Db; mode: "demo" | "real"; now(): number }
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")
export const randomToken = () => randomBytes(32).toString("base64url")
export function sessionContext(): SessionContext {
  return { db: getDb(), mode: readServerConfig().mode, now: Date.now }
}
export async function readCookie(name: string, request?: Request): Promise<string | undefined> {
  if (!request) return (await cookies()).get(name)?.value
  const raw = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1)
  if (!raw) return undefined
  try { return decodeURIComponent(raw) } catch { return undefined }
}
export async function createSession(ctx: SessionContext, userId: string) {
  const token = randomToken(), expiresAt = ctx.now() + SESSION_TTL_MS
  await run(ctx.db, "INSERT INTO sessions(id,token_hash,user_id,expires_at) VALUES (?,?,?,?)", [randomUUID(), hashToken(token), userId, expiresAt])
  return { token, expiresAt }
}
export async function revokeSession(ctx: SessionContext, token?: string) {
  if (token) await run(ctx.db, "UPDATE sessions SET revoked_at=?,revision=revision+1 WHERE token_hash=? AND revoked_at IS NULL", [ctx.now(), hashToken(token)])
}
export async function actorFromSession(ctx: SessionContext, token?: string): Promise<Actor> {
  const user = token ? await one<{ id: string; name: string }>(ctx.db, `SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`, [hashToken(token), ctx.now()]) : undefined
  if (!user) throw new DomainError("unauthenticated", "로그인이 필요해요")
  return { ...user, mode: ctx.mode }
}
/** RSC callers omit request; routes pass it so mutation checks happen at the boundary. */
export async function requireActor(request?: Request, injected?: SessionContext): Promise<Actor> {
  const ctx = injected ?? sessionContext()
  if (request && !["GET", "HEAD", "OPTIONS"].includes(request.method)) assertMutationOrigin(request)
  if (!injected) await ensureBound(ctx.db, ctx.mode) // callers that inject a context (tests) own their database
  if (ctx.mode === "real") return actorFromSession(ctx, await readCookie(SESSION_COOKIE, request))
  const id = await readCookie(USER_COOKIE, request)
  const user = (id ? await one<{ id: string; name: string }>(ctx.db, "SELECT id,name FROM users WHERE id=?", [id]) : undefined)
    ?? await one<{ id: string; name: string }>(ctx.db, "SELECT id,name FROM users ORDER BY id LIMIT 1")
  if (!user) throw new DomainError("unauthenticated", "데모 사용자를 먼저 준비해 주세요")
  return { ...user, mode: "demo" }
}
/** Strict Origin validation is the CSRF defense for every unsafe HTTP method. */
export function assertMutationOrigin(request: Request, trustedOrigin = new URL(request.url).origin): void {
  const origin = request.headers.get("origin")
  if (!origin || origin !== trustedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    console.warn("csrf_origin_mismatch", {origin, trustedOrigin, site:request.headers.get("sec-fetch-site"), host:request.headers.get("host")})
    throw new DomainError("csrf_failed", "요청 출처를 확인할 수 없어요")
  }
}
export function authCookie(name: string, value: string, url: string, maxAge: number): string {
  const target = new URL(url)
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  if (target.protocol !== "https:" && !(target.protocol === "http:" && loopback)) {
    throw new DomainError("forbidden", "HTTPS 연결이 필요해요")
  }
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${target.protocol === "https:" ? "; Secure" : ""}`
}
