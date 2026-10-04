import { NextResponse } from "next/server";
import { appUrl, consumeOAuthState, encryptToken, setSession, supabaseAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return NextResponse.redirect(appUrl("/?calendar_error=consent_denied"));
  const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(appUrl("/?calendar_error=invalid_callback"));
  const context = await consumeOAuthState(state);
  if (!context) return NextResponse.redirect(appUrl("/?calendar_error=invalid_state"));
  try {
    const origin = process.env.APP_URL!;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${origin.replace(/\/$/, "")}/api/auth/google/callback`, grant_type: "authorization_code" }), cache: "no-store" });
    if (!tokenResponse.ok) throw new Error("Google token exchange failed");
    const token = await tokenResponse.json() as { access_token: string; refresh_token?: string };
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
    if (!profileResponse.ok) throw new Error("Google profile lookup failed");
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
    if (!profile.sub || !profile.email || !profile.email_verified) throw new Error("Google account email is not verified");
    const db = supabaseAdmin();
    if (context.role === "owner") {
      const { data: old } = await db.from("owner_calendars").select("encrypted_refresh_token").eq("google_sub", profile.sub).maybeSingle();
      const refresh = token.refresh_token ? encryptToken(token.refresh_token) : old?.encrypted_refresh_token;
      if (!refresh) throw new Error("Google did not return a refresh token");
      const { error } = await db.from("owner_calendars").upsert({ google_sub: profile.sub, email: profile.email, encrypted_refresh_token: refresh, updated_at: new Date().toISOString() });
      if (error) throw error;
      await setSession({ sub: profile.sub, email: profile.email, role: "owner" });
      return NextResponse.redirect(appUrl("/owner"));
    }
    if (!context.shareCode) throw new Error("Missing share link");
    const { createHash } = await import("node:crypto");
    const codeHash = createHash("sha256").update(context.shareCode).digest("hex");
    const { data: share } = await db.from("share_links").select("id").eq("code_hash", codeHash).eq("active", true).maybeSingle();
    if (!share) return NextResponse.redirect(appUrl("/?calendar_error=invalid_link"));
    const { data: old } = await db.from("requester_calendars").select("encrypted_refresh_token").eq("share_link_id", share.id).eq("google_sub", profile.sub).maybeSingle();
    const refresh = token.refresh_token ? encryptToken(token.refresh_token) : old?.encrypted_refresh_token;
    if (!refresh) throw new Error("Google did not return a refresh token");
    const { error } = await db.from("requester_calendars").upsert({ share_link_id: share.id, google_sub: profile.sub, email: profile.email, encrypted_refresh_token: refresh, updated_at: new Date().toISOString() }, { onConflict: "share_link_id,google_sub" });
    if (error) throw error;
    await setSession({ sub: profile.sub, email: profile.email, role: "requester", shareId: share.id });
    return NextResponse.redirect(appUrl(`/request/${encodeURIComponent(context.shareCode)}`));
  } catch (error) {
    console.error("Google Calendar callback failed", error);
    return NextResponse.redirect(appUrl("/?calendar_error=connection_failed"));
  }
}
