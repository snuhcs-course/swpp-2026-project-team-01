import { NextResponse } from "next/server";
import { getCalendarEvents, getSession, jsonError, suggestSlots, supabaseAdmin } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "requester" || !session.shareId) return jsonError("요청 링크에서 Google Calendar를 먼저 연결해 주세요.", 401);
  let body: { name?: string; purpose?: string; duration?: number; location?: string };
  try { body = await request.json(); } catch { return jsonError("요청 내용을 확인해 주세요.", 400); }
  const name = body.name?.trim().slice(0, 100) ?? ""; const purpose = body.purpose?.trim().slice(0, 500) ?? "";
  const location = body.location?.trim().slice(0, 200) ?? ""; const duration = Number(body.duration);
  if (!name || !purpose || ![30, 45, 60, 90].includes(duration)) return jsonError("이름, 미팅 목적, 소요 시간을 확인해 주세요.", 400);
  const db = supabaseAdmin();
  const { data: requester, error: requesterError } = await db.from("requester_calendars").select("id,encrypted_refresh_token,email").eq("share_link_id", session.shareId).eq("google_sub", session.sub).maybeSingle();
  if (requesterError || !requester) return jsonError("요청자 캘린더 연결을 확인할 수 없습니다.", 401);
  const { data: link } = await db.from("share_links").select("id,owner_calendars(encrypted_refresh_token)").eq("id", session.shareId).eq("active", true).maybeSingle();
  if (!link) return jsonError("요청 링크가 만료되었거나 사용할 수 없습니다.", 404);
  const ownerCalendar = Array.isArray(link.owner_calendars) ? link.owner_calendars[0] : link.owner_calendars;
  if (!ownerCalendar?.encrypted_refresh_token) return jsonError("일정 소유자의 캘린더 연결을 찾을 수 없습니다.", 503);
  try {
    const from = new Date(); from.setDate(from.getDate() + 1); from.setHours(0, 0, 0, 0);
    const until = new Date(from); until.setDate(until.getDate() + 15);
    const [ownerEvents, requesterEvents] = await Promise.all([
      getCalendarEvents(ownerCalendar.encrypted_refresh_token, from, until), getCalendarEvents(requester.encrypted_refresh_token, from, until),
    ]);
    const slots = suggestSlots(ownerEvents, requesterEvents, duration, location);
    if (slots.length === 0) return jsonError("앞으로 2주 동안 가능한 시간을 찾지 못했어요. 기간이나 장소를 바꿔 다시 시도해 주세요.", 422);
    const { data, error } = await db.from("meeting_requests").insert({ share_link_id: session.shareId, requester_calendar_id: requester.id, requester_name: name, requester_email: requester.email, purpose, duration_minutes: duration, location, candidate_slots: slots }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ id: data.id });
  } catch (error) {
    console.error("Meeting request creation failed", error);
    return jsonError("캘린더 확인 또는 요청 저장에 실패했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.", 502);
  }
}
