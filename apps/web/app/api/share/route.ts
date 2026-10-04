import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession, jsonError, supabaseAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "owner") return jsonError("일정 소유자 로그인이 필요합니다.", 401);
  const code = randomBytes(24).toString("base64url");
  const codeHash = createHash("sha256").update(code).digest("hex");
  const { error } = await supabaseAdmin().from("share_links").insert({ code_hash: codeHash, owner_google_sub: session.sub });
  if (error) {
    console.error("Share link creation failed", error);
    return jsonError("요청 링크를 만들지 못했습니다.", 500);
  }
  return NextResponse.json({ url: `${process.env.APP_URL}/request/${code}` });
}
