import { OAuth2Client } from "google-auth-library"
import { DomainError } from "@/contracts/common"

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
] as const
export interface GoogleIdentity {
  subject: string; name: string; nonce: string; scopes: string[]; refreshToken?: string
}
export interface GoogleAccess { accessToken: string; expiresAt: number; refreshToken?: string }
export interface GoogleAuthProvider {
  authorizationUrl(input: { purpose: "login" | "calendar"; state: string; nonce: string }): string
  exchange(code: string): Promise<GoogleIdentity>
  refresh(refreshToken: string): Promise<GoogleAccess>
}
export function isInvalidGrant(error: unknown): boolean {
  if (error instanceof DomainError) return error.code === "calendar_reconnect_required"
  const e = error as { response?: { data?: { error?: string } } } | null
  return e?.response?.data?.error === "invalid_grant"
}
export class GoogleAuth implements GoogleAuthProvider {
  private readonly client: OAuth2Client
  constructor(private readonly config: { clientId: string; clientSecret: string; redirectUri: string },
    client?: OAuth2Client, private readonly now = Date.now) {
    this.client = client ?? new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri)
  }
  authorizationUrl(input: { purpose: "login" | "calendar"; state: string; nonce: string }): string {
    return this.client.generateAuthUrl({
      scope: ["openid", "email", "profile", ...(input.purpose === "calendar" ? CALENDAR_SCOPES : [])],
      state: input.state, nonce: input.nonce,
      ...(input.purpose === "calendar" ? { access_type: "offline", prompt: "consent" } : {}),
    })
  }
  async exchange(code: string): Promise<GoogleIdentity> {
    try {
      const { tokens } = await this.client.getToken(code)
      if (!tokens.id_token) throw new Error("Missing ID token")
      // The library verifies Google's signature, issuer, audience, and token lifetime.
      const ticket = await this.client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId })
      const payload = ticket.getPayload()
      const nonce = (payload as typeof payload & { nonce?: string })?.nonce
      if (!payload || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)
        || payload.aud !== this.config.clientId || !Number.isFinite(payload.exp) || payload.exp * 1000 <= this.now()
        || !payload.sub || !nonce) throw new Error("Invalid ID claims")
      return { subject: payload.sub, name: payload.name || "Google 사용자", nonce,
        scopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? [], refreshToken: tokens.refresh_token || undefined }
    } catch {
      // Never allow SDK errors (which can include request bodies and tokens) into logs or HTTP output.
      throw new DomainError("invalid_input", "Google 인증 응답을 확인할 수 없어요. 다시 로그인해 주세요")
    }
  }
  async refresh(refreshToken: string): Promise<GoogleAccess> {
    // A fresh client avoids sharing mutable credentials between concurrent owners.
    const client = new OAuth2Client(this.config.clientId, this.config.clientSecret, this.config.redirectUri)
    client.setCredentials({ refresh_token: refreshToken })
    try {
      const { credentials } = await client.refreshAccessToken()
      if (!credentials.access_token || !credentials.expiry_date) throw new Error("Missing access token")
      return { accessToken: credentials.access_token, expiresAt: credentials.expiry_date,
        refreshToken: credentials.refresh_token || undefined }
    } catch (error) {
      if (isInvalidGrant(error)) throw new DomainError("calendar_reconnect_required", "Google Calendar를 다시 연결해 주세요")
      throw new DomainError("calendar_fetch_failed", "Google Calendar 인증을 갱신하지 못했어요", true)
    }
  }
}
