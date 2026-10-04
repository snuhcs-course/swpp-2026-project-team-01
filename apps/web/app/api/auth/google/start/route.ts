import { NextResponse } from "next/server";
import { beginOAuthState, googleAuthorizeUrl, jsonError } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "requester" ? "requester" : "owner";
    const shareCode = url.searchParams.get("share") || undefined;
    if (role === "requester" && !shareCode) return jsonError("요청 링크가 필요합니다.", 400);
    const state = await beginOAuthState(role, shareCode);
    return NextResponse.redirect(await googleAuthorizeUrl(state, role));
  } catch (error) {
    console.error("Google OAuth configuration error", error);
    return jsonError("Google Calendar 연결 설정이 아직 완료되지 않았습니다.", 503);
  }
}
