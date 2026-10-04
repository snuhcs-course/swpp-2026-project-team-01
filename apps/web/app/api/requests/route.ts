import { NextResponse } from "next/server";
import { getCalendarEvents, getSession, jsonError, selectedSlotSuggestions, suggestSlots, supabaseAdmin } from "@/lib/server/auth";
import { linkIsOpen, seoulDay, type TimeWindow } from "@/lib/availability";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== "owner") {
      return jsonError("일정 소유자 로그인이 필요합니다.", 401);
    }

    const { data, error } = await supabaseAdmin()
      .from("share_links")
      .select(`
        id, created_at,
        meeting_requests (
          id, requester_name, requester_email, purpose, duration_minutes,
          location, candidate_slots, status, created_at, confirmed_start, confirmed_end, google_event_url
        )
      `)
      .eq("owner_google_sub", session.sub)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ links: data ?? [] });
  } catch (error) {
    console.error("Meeting request listing failed", error);
    return jsonError("요청을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "requester" || !session.shareId) return jsonError("요청 링크에서 Google Calendar를 먼저 연결해 주세요.", 401);
  let body: { name?: string; purpose?: string; duration?: number; location?: string };
  try { body = await request.json(); } catch { return jsonError("요청 내용을 확인해 주세요.", 400); }
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim().slice(0, 500) : "";
  const location = typeof body?.location === "string" ? body.location.trim().slice(0, 200) : "";
  if (!name || !purpose) return jsonError("이름과 미팅 목적을 확인해 주세요.", 400);
  const db = supabaseAdmin();
  const { data: requester, error: requesterError } = await db.from("requester_calendars").select("id,encrypted_refresh_token,email").eq("share_link_id", session.shareId).eq("google_sub", session.sub).maybeSingle();
  if (requesterError || !requester) return jsonError("요청자 캘린더 연결을 확인할 수 없습니다.", 401);
  const { data: link } = await db.from("share_links").select("id,active,deleted_at,availability_end,availability_windows,meeting_duration_minutes,owner_calendars(encrypted_refresh_token)").eq("id", session.shareId).maybeSingle();
  if (!link || !linkIsOpen(link)) return jsonError("요청 링크가 만료되었거나 사용할 수 없습니다.", 404);
  const duration = link.meeting_duration_minutes ?? Number(body.duration);
  if (!link.meeting_duration_minutes && ![30, 45, 60, 90].includes(duration)) return jsonError("소요 시간을 확인해 주세요.", 400);
  const ownerCalendar = Array.isArray(link.owner_calendars) ? link.owner_calendars[0] : link.owner_calendars;
  if (!ownerCalendar?.encrypted_refresh_token) return jsonError("일정 소유자의 캘린더 연결을 찾을 수 없습니다.", 503);
  let stage: "calendar" | "suggestions" | "save" = "calendar";
  try {
    const from = seoulDay(0); const until = seoulDay(16);
    const [ownerEvents, requesterEvents] = await Promise.all([
      getCalendarEvents(ownerCalendar.encrypted_refresh_token, from, until), getCalendarEvents(requester.encrypted_refresh_token, from, until),
    ]);
    stage = "suggestions";
    const windows = link.availability_windows as TimeWindow[] | null;
    const slots = link.meeting_duration_minutes && windows
      ? selectedSlotSuggestions(ownerEvents, requesterEvents, windows, location)
      : suggestSlots(ownerEvents, requesterEvents, duration, location, windows);
    if (slots.length === 0) return jsonError("이 링크의 공개 시간 안에서 가능한 시간을 찾지 못했어요. 소요 시간이나 장소를 조정하거나 소유자에게 새 링크를 요청해 주세요.", 422);
    stage = "save";
    const { data, error } = await db.from("meeting_requests").insert({ share_link_id: session.shareId, requester_calendar_id: requester.id, requester_name: name, requester_email: requester.email, purpose, duration_minutes: duration, location, candidate_slots: slots }).select("id").single();
    if (error?.message.includes("share_link_unavailable")) return jsonError("요청 링크가 닫혔습니다. 일정 소유자에게 확인해 주세요.", 409);
    if (error) throw error;
    return NextResponse.json({ id: data.id });
  } catch (error) {
    console.error("Meeting request creation failed", { stage, error });
    const messages = {
      calendar: "Google Calendar 일정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.",
      suggestions: "후보 시간을 계산하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      save: "미팅 요청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
    return jsonError(messages[stage], stage === "calendar" ? 502 : 500);
  }
}
