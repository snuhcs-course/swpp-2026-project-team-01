import { emptyDb } from './helpers'
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSession, requireActor, revokeSession, assertMutationOrigin, SESSION_COOKIE } from "@/server/session"
import { startGoogleAuth, completeGoogleAuth, refreshCalendarAccess, type AuthContext } from "@/server/services/auth"
import { TokenVault } from "@/server/token-vault"
import { CALENDAR_SCOPES, type GoogleAuthProvider } from "@/server/providers/google-auth"

let store: Awaited<ReturnType<typeof emptyDb>>
let time = 1000000
let subject = "google-owner"
let nonce = ""
let refreshToken: string | undefined = "refresh-secret"
let exchangeHook: (() => void) | undefined
let refreshError: unknown
let ctx: AuthContext
const browser = { browserToken: "browser-secret" }
function request(cookie = "", method = "GET", origin?: string) {
  return new Request("https://app.example/api/me", { method, headers: { cookie, ...(origin ? { origin } : {}) } })
}
async function begin(purpose: "login" | "calendar" = "login", binding = browser) {
  const start = await startGoogleAuth(ctx, binding, { purpose, returnPath: "/calendar" })
  return { state: new URL(start.authorizationUrl).searchParams.get("state")!, code: "code" }
}
async function login() {
  const result = await completeGoogleAuth(ctx, browser, await begin())
  return { browserToken: "calendar-browser", sessionToken: result.sessionToken! }
}
beforeEach(async () => {
  store = await emptyDb()
  time = 1000000; subject = "google-owner"; refreshToken = "refresh-secret"; exchangeHook = undefined; refreshError = undefined
  const provider: GoogleAuthProvider = {
    authorizationUrl(input) { nonce = input.nonce; return `https://accounts.google.com/o/oauth2/v2/auth?state=${input.state}` },
    async exchange() { exchangeHook?.(); return { subject, name: "Owner", nonce, scopes: [...CALENDAR_SCOPES], refreshToken } },
    async refresh() { if (refreshError) throw refreshError; return { accessToken: "access", expiresAt: time + 3600000 } },
  }
  ctx = { db: store.db, mode: "real", now: () => time, provider, vault: new TokenVault(Buffer.alloc(32, 7)) }
})
afterEach(() => {
  store.sqlite.close(); vi.unstubAllEnvs(); vi.restoreAllMocks()
  delete (globalThis as unknown as { __mvpDb?: unknown }).__mvpDb
})

describe("session boundary", () => {
  it("rejects real uid bypass while demo retains seed fallback", async () => {
    ;(await store.sqlite.prepare("INSERT INTO users(id,name) VALUES ('seed','Demo')").run())
    await expect(requireActor(request("uid=seed"), ctx)).rejects.toMatchObject({ code: "unauthenticated" })
    expect(await requireActor(request(), { ...ctx, mode: "demo" })).toMatchObject({ id: "seed", name: "Demo", mode: "demo" })
  })
  it("stores only hashes and expires at exactly seven days; revoke is idempotent", async () => {
    ;(await store.sqlite.prepare("INSERT INTO users(id,name) VALUES ('u','User')").run())
    const session = (await createSession(ctx, "u"))
    expect(JSON.stringify((await store.sqlite.prepare("SELECT * FROM sessions").all()))).not.toContain(session.token)
    expect(await requireActor(request(`${SESSION_COOKIE}=${session.token}`), ctx)).toMatchObject({ id: "u" })
    time += 7 * 86400000
    await expect(requireActor(request(`${SESSION_COOKIE}=${session.token}`), ctx)).rejects.toMatchObject({ code: "unauthenticated" })
    const other = (await createSession(ctx, "u"))
    ;(await revokeSession(ctx, other.token)); (await revokeSession(ctx, other.token))
    await expect(requireActor(request(`${SESSION_COOKIE}=${other.token}`), ctx)).rejects.toMatchObject({ code: "unauthenticated" })
  })
  it("rejects missing/cross-site Origin and accepts exact origin", () => {
    expect(() => assertMutationOrigin(request("", "POST"))).toThrow()
    expect(() => assertMutationOrigin(request("", "POST", "https://evil.example"))).toThrow()
    expect(() => assertMutationOrigin(request("", "POST", "https://app.example"))).not.toThrow()
  })
})

describe("OAuth lifecycle", () => {
  it("creates a sub-keyed account and consumes state once", async () => {
    const input = await begin()
    const result = await completeGoogleAuth(ctx, browser, input)
    expect(result.returnPath).toBe("/calendar")
    expect(result.sessionToken).toBeTruthy()
    await expect(completeGoogleAuth(ctx, browser, input)).rejects.toMatchObject({ code: "invalid_input" })
    await completeGoogleAuth(ctx, browser, await begin())
    expect((await store.sqlite.prepare("SELECT count(*) n FROM users").get())).toEqual({ n: 1 })
    expect((await store.sqlite.prepare("SELECT subject FROM auth_identities").get())).toEqual({ subject: "google-owner" })
  })
  it("rejects foreign browser, nonce, expired state, and unsafe redirects without partial writes", async () => {
    const input = await begin()
    await expect(completeGoogleAuth(ctx, { browserToken: "foreign" }, input)).rejects.toMatchObject({ code: "invalid_input" })
    nonce = "wrong"
    await expect(completeGoogleAuth(ctx, browser, input)).rejects.toMatchObject({ code: "invalid_input" })
    time += 600000
    await expect(completeGoogleAuth(ctx, browser, input)).rejects.toMatchObject({ code: "invalid_input" })
    for (const returnPath of ["https://evil.example", "//evil.example", "/calendar/../../api/session", "/calendar/private-id"]) {
      await expect(startGoogleAuth(ctx, browser, { purpose: "login", returnPath })).rejects.toThrow()
    }
    expect((await store.sqlite.prepare("SELECT count(*) n FROM users").get())).toEqual({ n: 0 })
  })
  it("separates demo from real authorization", async () => {
    await expect(startGoogleAuth({ ...ctx, mode: "demo" }, browser, { purpose: "login", returnPath: "/" })).rejects.toMatchObject({ code: "forbidden" })
  })
  it("rejects foreign sub and preserves existing refresh token on same-sub re-consent", async () => {
    const binding = await login()
    const input = await begin("calendar", binding)
    subject = "other-account"
    await expect(completeGoogleAuth(ctx, binding, input)).rejects.toMatchObject({ code: "account_mismatch" })
    expect((await store.sqlite.prepare("SELECT count(*) n FROM calendar_connections").get())).toEqual({ n: 0 })
    subject = "google-owner"
    await completeGoogleAuth(ctx, binding, await begin("calendar", binding))
    const old = (await store.sqlite.prepare("SELECT refresh_token_ciphertext FROM calendar_connections").get())
    expect(JSON.stringify(old)).not.toContain("refresh-secret")
    refreshToken = undefined
    await completeGoogleAuth(ctx, binding, await begin("calendar", binding))
    expect((await store.sqlite.prepare("SELECT refresh_token_ciphertext FROM calendar_connections").get())).toEqual(old)
  })
  it("rejects callback after disconnect fence moves during token exchange", async () => {
    const binding = await login()
    await completeGoogleAuth(ctx, binding, await begin("calendar", binding))
    const input = await begin("calendar", binding)
    exchangeHook = async () => (await store.sqlite.prepare("UPDATE calendar_connections SET generation=generation+1, revision=revision+1, status='disconnected', refresh_token_ciphertext=NULL").run())
    await expect(completeGoogleAuth(ctx, binding, input)).rejects.toMatchObject({ code: "source_changed" })
    expect((await store.sqlite.prepare("SELECT status,refresh_token_ciphertext FROM calendar_connections").get())).toEqual({ status: "disconnected", refresh_token_ciphertext: null })
  })
  it("marks invalid_grant reconnect required and cannot refresh for another owner", async () => {
    const binding = await login()
    await completeGoogleAuth(ctx, binding, await begin("calendar", binding))
    const actor = await requireActor(request(`${SESSION_COOKIE}=${binding.sessionToken}`), ctx)
    await expect(refreshCalendarAccess(ctx, "other-owner")).rejects.toMatchObject({ code: "not_found" })
    refreshError = { response: { data: { error: "invalid_grant" } } }
    await expect(refreshCalendarAccess(ctx, actor.id)).rejects.toMatchObject({ code: "calendar_reconnect_required" })
    expect((await store.sqlite.prepare("SELECT status FROM calendar_connections").get())).toEqual({ status: "reconnect_required" })
  })
})


describe("auth HTTP boundary", () => {
  function routesEnv(mode = "real") {
    vi.stubEnv("APP_MODE", mode)
    vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/db")
    vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client")
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret")
    vi.stubEnv("GOOGLE_REDIRECT_URI", "https://app.example/api/auth/google/callback")
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"))
    ;(globalThis as unknown as { __mvpDb: typeof store }).__mvpDb = store
  }
  it("disables real user switching and reports JSON auth errors without secrets", async () => {
    routesEnv()
    const { POST } = await import("@/app/api/session/route")
    const result = await POST(new Request("https://app.example/api/session", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ userId: "seed" }) }))
    expect(result.status).toBe(403)
    expect(await result.json()).toMatchObject({ ok: false, error: { code: "forbidden" }, meta: { outcome: "not_applied" } })
    const { GET } = await import("@/app/api/me/route")
    const me = await GET(request("uid=seed"))
    expect(me.status).toBe(401)
    expect(await me.json()).toMatchObject({ ok: false, error: { code: "unauthenticated" } })
  })
  it("supports demo switching with same-origin CSRF defense and a complete envelope", async () => {
    routesEnv("demo")
    ;(await store.sqlite.prepare("INSERT INTO users(id,name) VALUES ('demo','Demo')").run())
    const { POST } = await import("@/app/api/session/route")
    const denied = await POST(new Request("https://app.example/api/session", { method: "POST", body: JSON.stringify({ userId: "demo" }) }))
    expect(denied.status).toBe(403)
    const result = await POST(new Request("https://app.example/api/session", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ userId: "demo" }) }))
    expect(await result.json()).toMatchObject({ ok: true, data: { actor: { id: "demo", mode: "demo" } }, meta: {} })
    expect(result.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax")
  })
  it("starts via POST, binds callback cookie, sets secure session, reads me and logs out idempotently", async () => {
    routesEnv()
    const { GoogleAuth } = await import("@/server/providers/google-auth")
    const { POST: start } = await import("@/app/api/auth/google/start/route")
    const { GET: callback } = await import("@/app/api/auth/google/callback/route")
    const { GET: me } = await import("@/app/api/me/route")
    const { POST: logout } = await import("@/app/api/auth/logout/route")
    const started = await start(new Request("https://app.example/api/auth/google/start", { method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ purpose: "login", returnPath: "/onboarding" }) }))
    const payload = await started.json()
    expect(payload).toMatchObject({ ok: true, meta: {} })
    const url = new URL(payload.data.authorizationUrl)
    const cookie = started.headers.get("set-cookie")!.split(";")[0]
    expect(started.headers.get("set-cookie")).toContain("Max-Age=600; Secure")
    vi.spyOn(GoogleAuth.prototype, "exchange").mockResolvedValue({ subject: "route-owner", name: "Route Owner", nonce: url.searchParams.get("nonce")!, scopes: [] })
    const cbUrl = `https://app.example/api/auth/google/callback?code=fixture&state=${url.searchParams.get("state")}`
    const finished = await callback(new Request(cbUrl, { headers: { cookie } }))
    expect(finished.status).toBe(303)
    expect(finished.headers.get("location")).toBe("https://app.example/onboarding")
    const session = finished.headers.getSetCookie().find(c => c.startsWith(`${SESSION_COOKIE}=`))!
    expect(session).toContain("Max-Age=604800; Secure")
    const authCookie = session.split(";")[0]
    const profile = await me(request(authCookie))
    const profileBody = await profile.json()
    expect(profileBody).toMatchObject({ ok: true, data: { actor: { name: "Route Owner", mode: "real" }, setupState: "not_started", bookingReady: false }, meta: {} })
    expect(JSON.stringify(profileBody)).not.toMatch(/token|ciphertext/)
    expect((await callback(new Request(cbUrl, { headers: { cookie } }))).status).toBe(400)
    for (let i = 0; i < 2; i++) expect((await logout(request(authCookie, "POST", "https://app.example"))).status).toBe(200)
    expect((await me(request(authCookie))).status).toBe(401)
  })
})
