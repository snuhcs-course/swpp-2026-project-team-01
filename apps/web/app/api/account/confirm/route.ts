// AI-generated with OpenAI Codex, 2026-10-05.
import { NextResponse } from "next/server";
import { accountClient } from "@/lib/server/account";
import { appUrl, clearSession } from "@/lib/server/auth";
export async function GET(request: Request) {
  const code=new URL(request.url).searchParams.get("code");
  if(code) {
    const client=await accountClient();
    const {error}=await client.auth.exchangeCodeForSession(code);
    if(!error) {await clearSession();return NextResponse.redirect(appUrl("/account"));}
  }
  return NextResponse.redirect(appUrl("/login?error=confirmation_failed"));
}
