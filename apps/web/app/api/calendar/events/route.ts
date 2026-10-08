// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
import { NextResponse } from "next/server";
import { getCalendarEvents, getSession, jsonError, supabaseAdmin } from "@/lib/server/auth";
import { availabilityPeriod, DAY_MS, ownerAvailability, seoulDay, SEOUL_OFFSET } from "@/lib/availability";

export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "owner") return jsonError("일정 소유자 로그인이 필요합니다.", 401);
  try {
    const { data, error } = await supabaseAdmin().from("owner_calendars").select("encrypted_refresh_token").eq("google_sub", session.sub).maybeSingle();
    if (error) throw error;
    if (!data) return jsonError("Google Calendar를 다시 연결해 주세요.", 409);
    const now = Date.now();
    const today = seoulDay(0, 0, 0, now).getTime();
    const weekday = new Date(today + SEOUL_OFFSET).getUTCDay();
    const start = new Date(today - ((weekday + 6) % 7) * DAY_MS);
    const end = new Date(start.getTime() + 21 * DAY_MS);
    const events = await getCalendarEvents(data.encrypted_refresh_token, start, end, true);
    return NextResponse.json({
      events: events.map((event) => ({ ...event, start: event.start.toISOString(), end: event.end.toISOString() })),
      windows: ownerAvailability(events, now), period: availabilityPeriod(now),
      calendarStart: start.toISOString(), calendarEnd: end.toISOString(), today: new Date(today).toISOString(), updatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return jsonError("캘린더를 불러오지 못했습니다. 다시 시도하거나 Google 계정을 다시 연결해 주세요.", 502); }
}
