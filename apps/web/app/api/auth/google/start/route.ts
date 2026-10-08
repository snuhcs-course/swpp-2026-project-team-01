// AI provenance: OpenAI Codex; initially generated 2026-10-04 (Asia/Seoul); scope: file.
import { NextResponse } from "next/server";
import { appUrl, beginOAuthState, getSession, googleAuthorizeUrl, jsonError } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url=new URL(request.url);
    const role=url.searchParams.get("role")==="requester"?"requester":"owner";
    const share=url.searchParams.get("share") || undefined;
    if(role==="requester" && (!share || !/^[A-Za-z0-9_-]{20,100}$/.test(share))) return jsonError("요청 링크가 필요합니다.",400);
    if(url.searchParams.get("reconnect")!=="1") {
      const session=await getSession();
      if(session?.role==="owner") return NextResponse.redirect(appUrl(role==="owner"?"/owner":"/request/"+share));
    }
    const state=await beginOAuthState(role,share);
    return NextResponse.redirect(await googleAuthorizeUrl(state,role));
  } catch {return jsonError("Google 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",503);}
}
