import { randomUUID } from "node:crypto"
import { ZodError } from "zod"
import { authStartSchema, authCallbackSchema, type AuthStartInput, type AuthStartView, type AuthCallbackInput, type AuthCallbackResult } from "@/contracts/auth"
import { DomainError } from "@/contracts/common"
import { ensureBound, getDb, lock, one, run } from "../db/client"
import { readServerConfig } from "../config"
import { GoogleAuth, CALENDAR_SCOPES, isInvalidGrant, type GoogleAuthProvider } from "../providers/google-auth"
import { TokenVault } from "../token-vault"
import { actorFromSession, createSession, revokeSession, hashToken, randomToken, OAUTH_TTL_MS, type SessionContext } from "../session"

export interface AuthContext extends SessionContext { provider: GoogleAuthProvider; vault: TokenVault }
/** Values come exclusively from HttpOnly cookies, never JSON user IDs. */
export interface AuthBinding { browserToken: string; sessionToken?: string }
interface Attempt { id: string; nonce_hash: string; browser_binding_hash: string; purpose: "login" | "calendar";
  user_id: string | null; return_path: string; expires_at: number; consumed_at: number | null }
interface Connection { id: string; user_id: string; subject: string; status: string; revision: number; generation: number;
  refresh_token_ciphertext: string | null; key_version: number | null }
export function authContext(): AuthContext {
  const config = readServerConfig()
  if (config.mode !== "real") throw new DomainError("forbidden", "데모 모드에서는 Google 계정을 연결하지 않아요")
  if (!config.googleClientId || !config.googleClientSecret || !config.googleRedirectUri || !config.tokenEncryptionKey) {
    throw new DomainError("internal_error", "Google 로그인 설정이 필요해요")
  }
  return { db: getDb(), mode: config.mode, now: Date.now,
    provider: new GoogleAuth({ clientId: config.googleClientId, clientSecret: config.googleClientSecret, redirectUri: config.googleRedirectUri }),
    vault: new TokenVault(config.tokenEncryptionKey) }
}
const invalid = () => new DomainError("invalid_input", "인증 요청이 만료되었거나 올바르지 않아요. 다시 시작해 주세요")
// Only collection/static destinations are allowed, so redirects cannot disclose private resource IDs.
const RETURN_PATHS = new Set(["/", "/calendar", "/book", "/requests", "/settings", "/settings/calendars", "/onboarding", "/onboarding/review"])
function safeReturnPath(path: string): string {
  if (!RETURN_PATHS.has(path)) throw new DomainError("invalid_input", "허용된 앱 내부 경로로 이동해 주세요")
  return path
}
function connection(ctx: SessionContext, userId: string): Promise<Connection | undefined> {
  return one<Connection>(ctx.db, "SELECT * FROM calendar_connections WHERE user_id=?", [userId])
}
async function bindingHash(ctx: SessionContext, binding: AuthBinding, purpose: Attempt["purpose"], userId: string | null): Promise<string> {
  if (!binding.browserToken) throw invalid()
  const current = purpose === "calendar" && userId ? await connection(ctx, userId) : undefined
  return hashToken(JSON.stringify([binding.browserToken, binding.sessionToken ?? null, purpose, userId,
    current ? [current.id, current.generation, current.revision, current.status] : null]))
}
async function requireCalendarOwner(ctx: SessionContext, binding: AuthBinding, expected?: string | null) {
  const actor = await actorFromSession(ctx, binding.sessionToken)
  if (expected && actor.id !== expected) throw new DomainError("account_mismatch", "로그인한 계정과 연결 계정이 달라요")
  return actor
}
const tokenOwner = (row: Pick<Connection, "id" | "user_id" | "subject">) => JSON.stringify([row.user_id, row.subject, row.id])
export async function startGoogleAuth(ctx: AuthContext, binding: AuthBinding, raw: AuthStartInput): Promise<AuthStartView> {
  if (ctx.mode !== "real") throw new DomainError("forbidden", "데모 모드에서는 Google 계정을 연결하지 않아요")
  await ensureBound(ctx.db, ctx.mode)
  const input = authStartSchema.parse(raw), returnPath = safeReturnPath(input.returnPath)
  const userId = input.purpose === "calendar" ? (await requireCalendarOwner(ctx, binding)).id : null
  const state = randomToken(), nonce = randomToken()
  const authorizationUrl = ctx.provider.authorizationUrl({ purpose: input.purpose, state, nonce })
  await run(ctx.db, `INSERT INTO oauth_attempts(id,state_hash,nonce_hash,browser_binding_hash,purpose,user_id,return_path,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`, [randomUUID(), hashToken(state), hashToken(nonce), await bindingHash(ctx, binding, input.purpose, userId),
      input.purpose, userId, returnPath, ctx.now() + OAUTH_TTL_MS])
  return { authorizationUrl }
}
export async function completeGoogleAuth(ctx: AuthContext, binding: AuthBinding, raw: AuthCallbackInput): Promise<AuthCallbackResult & { sessionToken?: string }> {
  if (ctx.mode !== "real") throw new DomainError("forbidden", "데모 모드에서는 Google 계정을 연결하지 않아요")
  await ensureBound(ctx.db, ctx.mode)
  const input = authCallbackSchema.parse(raw)
  const attempt = await one<Attempt>(ctx.db, "SELECT * FROM oauth_attempts WHERE state_hash=?", [hashToken(input.state)])
  if (!attempt || attempt.consumed_at !== null || attempt.expires_at <= ctx.now()) throw invalid()
  if (attempt.purpose === "calendar") await requireCalendarOwner(ctx, binding, attempt.user_id)
  if (attempt.browser_binding_hash !== await bindingHash(ctx, binding, attempt.purpose, attempt.user_id)) throw invalid()
  safeReturnPath(attempt.return_path)
  const identity = await ctx.provider.exchange(input.code)
  if (!identity.subject || hashToken(identity.nonce) !== attempt.nonce_hash) throw invalid()
  return ctx.db.transaction(async (tx) => {
    const t: AuthContext = { ...ctx, db: tx }
    // The first sign-in of an account must create the user exactly once, even if two callbacks race.
    await lock(tx, `auth:${identity.subject}`)
    if (attempt.expires_at <= ctx.now()) throw invalid()
    if (attempt.purpose === "calendar") await requireCalendarOwner(t, binding, attempt.user_id)
    if (attempt.browser_binding_hash !== await bindingHash(t, binding, attempt.purpose, attempt.user_id)) {
      throw new DomainError("source_changed", "연결 상태가 변경되었어요. 다시 시작해 주세요")
    }
    const consumed = await run(tx, "UPDATE oauth_attempts SET consumed_at=?,revision=revision+1 WHERE id=? AND consumed_at IS NULL AND expires_at>?", [ctx.now(), attempt.id, ctx.now()])
    if (!consumed) throw invalid()
    if (attempt.purpose === "login") {
      const existing = await one<{ user_id: string }>(tx, "SELECT user_id FROM auth_identities WHERE provider='google' AND subject=?", [identity.subject])
      const userId = existing?.user_id ?? randomUUID()
      if (!existing) {
        await run(tx, "INSERT INTO users(id,name) VALUES (?,?)", [userId, identity.name])
        await run(tx, "INSERT INTO auth_identities(id,user_id,provider,subject) VALUES (?,?,'google',?)", [randomUUID(), userId, identity.subject])
      }
      const session = await createSession(t, userId)
      await revokeSession(t, binding.sessionToken)
      return { returnPath: attempt.return_path, sessionToken: session.token }
    }
    const owner = await one<{ subject: string }>(tx, "SELECT subject FROM auth_identities WHERE provider='google' AND user_id=?", [attempt.user_id])
    if (!owner || owner.subject !== identity.subject) throw new DomainError("account_mismatch", "로그인한 Google 계정으로 Calendar를 연결해 주세요")
    if (!CALENDAR_SCOPES.every(scope => identity.scopes.includes(scope))) {
      throw new DomainError("calendar_reconnect_required", "Calendar 읽기 권한을 모두 허용해 주세요")
    }
    const old = await connection(t, attempt.user_id!)
    const row = { id: old?.id ?? randomUUID(), user_id: attempt.user_id!, subject: identity.subject }
    let ciphertext = identity.refreshToken ? ctx.vault.encrypt(identity.refreshToken, tokenOwner(row)) : undefined
    if (!ciphertext && old?.subject === identity.subject && old.status === "connected" && old.refresh_token_ciphertext) {
      ctx.vault.decrypt(old.refresh_token_ciphertext, tokenOwner(row))
      ciphertext = old.refresh_token_ciphertext
    }
    if (!ciphertext) throw new DomainError("calendar_reconnect_required", "오프라인 접근을 허용해 Calendar를 다시 연결해 주세요")
    if (old) await run(tx, `UPDATE calendar_connections SET subject=?,status='connected',refresh_token_ciphertext=?,key_version=1,
      granted_scopes_json=?,revision=revision+1 WHERE id=?`, [identity.subject, ciphertext, JSON.stringify(identity.scopes), old.id])
    else await run(tx, `INSERT INTO calendar_connections(id,user_id,subject,status,refresh_token_ciphertext,key_version,granted_scopes_json)
      VALUES (?,?,?,'connected',?,1,?)`, [row.id, row.user_id, row.subject, ciphertext, JSON.stringify(identity.scopes)])
    await run(tx, "UPDATE users SET calendar_use_state='needs_refresh',calendar_use_revision=calendar_use_revision+1 WHERE id=?", [attempt.user_id])
    return { returnPath: attempt.return_path }
  })
}
/** Internal owner-scoped integration point. Callers must pass the authenticated actor's ID. */
export async function refreshCalendarAccess(ctx: AuthContext, userId: string) {
  const row = await connection(ctx, userId)
  if (!row) throw new DomainError("not_found", "연결을 찾을 수 없어요")
  if (row.status !== "connected" || !row.refresh_token_ciphertext) throw new DomainError("calendar_reconnect_required", "Calendar를 다시 연결해 주세요")
  let refreshToken: string
  try { refreshToken = ctx.vault.decrypt(row.refresh_token_ciphertext, tokenOwner(row)) }
  catch { throw new DomainError("calendar_reconnect_required", "Calendar를 다시 연결해 주세요") }
  try {
    const result = await ctx.provider.refresh(refreshToken)
    return await ctx.db.transaction(async (tx) => {
      await lock(tx, `connection:${row.id}`)
      const current = await connection({ ...ctx, db: tx }, userId)
      if (!current || current.id !== row.id || current.generation !== row.generation || current.revision !== row.revision || current.status !== "connected") {
        throw new DomainError("source_changed", "연결 상태가 변경되었어요")
      }
      if (result.refreshToken && result.refreshToken !== refreshToken) {
        await run(tx, "UPDATE calendar_connections SET refresh_token_ciphertext=?,key_version=1,revision=revision+1 WHERE id=?", [ctx.vault.encrypt(result.refreshToken, tokenOwner(row)), row.id])
      }
      return { accessToken: result.accessToken, expiresAt: result.expiresAt }
    })
  } catch (error) {
    if (isInvalidGrant(error)) {
      await run(ctx.db, `UPDATE calendar_connections SET status='reconnect_required',refresh_token_ciphertext=NULL,key_version=NULL,revision=revision+1
        WHERE id=? AND user_id=? AND generation=? AND revision=? AND status='connected'`, [row.id, userId, row.generation, row.revision])
      throw new DomainError("calendar_reconnect_required", "Calendar를 다시 연결해 주세요")
    }
    if (error instanceof DomainError) throw error
    throw new DomainError("calendar_fetch_failed", "Google Calendar 인증을 갱신하지 못했어요", true)
  }
}
/** Auth routes avoid logging provider errors or credentials; all JSON uses the shared envelope. */
export async function handleAuth(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn() } catch (error) {
    const e = error instanceof DomainError ? error : error instanceof ZodError
      ? new DomainError("invalid_input", "요청 입력을 확인해 주세요") : new DomainError("internal_error", "인증을 처리하지 못했어요")
    const status = e.code === "unauthenticated" ? 401 : ["forbidden", "csrf_failed"].includes(e.code) ? 403
      : e.code === "not_found" ? 404 : ["source_changed", "calendar_reconnect_required"].includes(e.code) ? 409
      : e.code === "internal_error" ? 500 : 400
    return Response.json({ ok: false, error: { code: e.code, message: e.message, retryable: e.retryable },
      meta: { outcome: status === 500 ? "unknown" : "not_applied" } }, { status, headers: { "Cache-Control": "no-store" } })
  }
}
