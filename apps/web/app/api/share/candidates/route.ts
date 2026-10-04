import { NextResponse } from "next/server";
import { getSession, supabaseAdmin, getCalendarEvents, jsonError } from "@/lib/server/auth";
import { seoulDay } from "@/lib/availability";
import { hostCandidates, validateLinkOptions } from "@/lib/link-options";
import { signPreview } from "@/lib/server/link-preview";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "owner") return jsonError("일정 소유자 로그인이 필요합니다.", 401);
  let options;
  try { options = validateLinkOptions(await request.json()); }
  catch (cause) { return jsonError(cause instanceof Error ? cause.message : "공개 조건을 확인해 주세요.", 400); }
  try {
    const { data, error } = await supabaseAdmin().from("owner_calendars").select("encrypted_refresh_token").eq("google_sub", session.sub).single();
    if (error || !data) return jsonError("Google Calendar 연결을 확인해 주세요.", 409);
    const events = await getCalendarEvents(data.encrypted_refresh_token, seoulDay(0), seoulDay(16));
    const candidates = hostCandidates(events, options);
    return NextResponse.json({ candidates, preview: signPreview(session.sub, options, candidates) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return jsonError("Google Calendar의 후보를 불러오지 못했습니다. 다시 시도해 주세요.", 502); }
}
