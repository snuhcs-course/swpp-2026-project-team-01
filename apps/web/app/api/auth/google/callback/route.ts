// AI provenance: OpenAI Codex; initially generated 2026-10-04 (Asia/Seoul); scope: file.
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { appUrl, clearSession, consumeOAuthState, encryptToken, OWNER_WRITE_SCOPE, setSession, supabaseAdmin } from "@/lib/server/auth";
import { getAccount } from "@/lib/server/account";
import { linkIsOpen } from "@/lib/availability";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  const url=new URL(request.url);
  const account=await getAccount();
  const errorPath=account?"/account?calendar_error=":"/?calendar_error=";
  if(url.searchParams.has("error")) return NextResponse.redirect(appUrl(errorPath+"consent_denied"));
  const code=url.searchParams.get("code"); const state=url.searchParams.get("state");
  if(!code || !state) return NextResponse.redirect(appUrl(errorPath+"invalid_callback"));
  const context=await consumeOAuthState(state);
  if(!context || (context.accountId??null)!==(account?.id??null)) return NextResponse.redirect(appUrl(errorPath+"invalid_state"));
  try {
    const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,redirect_uri:appUrl("/api/auth/google/callback"),grant_type:"authorization_code"}),cache:"no-store"});
    if(!response.ok) throw Error("token_exchange_failed");
    const token=await response.json() as {access_token:string;refresh_token?:string;scope?:string};
    const profileResponse=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{authorization:"Bearer "+token.access_token},cache:"no-store"});
    if(!profileResponse.ok) throw Error("profile_failed");
    const profile=await profileResponse.json() as {sub?:string;email?:string;email_verified?:boolean};
    if(!profile.sub || !profile.email || !profile.email_verified) throw Error("invalid_profile");
    const db=supabaseAdmin();
    const {data:old,error:oldError}=await db.from("owner_calendars").select("encrypted_refresh_token").eq("google_sub",profile.sub).maybeSingle();
    if(oldError) throw oldError;
    let refresh=token.refresh_token?encryptToken(token.refresh_token):old?.encrypted_refresh_token;
    const write=(token.scope??"").split(" ").some(scope=>[OWNER_WRITE_SCOPE,"https://www.googleapis.com/auth/calendar.events","https://www.googleapis.com/auth/calendar"].includes(scope));
    let shareId:string|undefined;
    if(context.role==="requester") {
      if(!context.shareCode) throw Error("missing_link");
      const {data:share}=await db.from("share_links").select("id,active,deleted_at,availability_end").eq("code_hash",createHash("sha256").update(context.shareCode).digest("hex")).maybeSingle();
      if(!share || !linkIsOpen(share)) throw Error("invalid_link");
      shareId=share.id;
      if(!refresh) {
        const {data:previous}=await db.from("requester_calendars").select("encrypted_refresh_token").eq("share_link_id",shareId).eq("google_sub",profile.sub).maybeSingle();
        refresh=previous?.encrypted_refresh_token;
      }
    }
    if(!refresh) throw Error("refresh_token_missing");
    if(account) {
      const {error}=await db.rpc("link_account_calendar",{p_account_id:account.id,p_google_sub:profile.sub,p_email:profile.email,p_token:refresh,p_write:write});
      if(error) throw error;
      await clearSession();
    } else if(context.role==="owner") {
      const {error}=await db.from("owner_calendars").upsert({google_sub:profile.sub,email:profile.email,encrypted_refresh_token:refresh,calendar_write_enabled:write,updated_at:new Date().toISOString()});
      if(error) throw error;
      await setSession({sub:profile.sub,email:profile.email,role:"owner"});
    }
    if(context.role==="requester") {
      const {error}=await db.from("requester_calendars").upsert({share_link_id:shareId,google_sub:profile.sub,email:profile.email,encrypted_refresh_token:refresh,updated_at:new Date().toISOString()},{onConflict:"share_link_id,google_sub"});
      if(error) throw error;
      if(!account) await setSession({sub:profile.sub,email:profile.email,role:"requester",shareId});
      return NextResponse.redirect(appUrl("/request/"+context.shareCode));
    }
    return NextResponse.redirect(appUrl("/owner"));
  } catch {
    return NextResponse.redirect(appUrl(errorPath+"connection_failed"));
  }
}
