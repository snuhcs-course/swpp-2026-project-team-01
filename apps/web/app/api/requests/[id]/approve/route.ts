import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCalendarEvents, getSession, jsonError, refreshGoogleAccessToken, slotIsAvailable, supabaseAdmin } from "@/lib/server/auth";
import { CalendarWriteError, findGoogleBooking, insertGoogleBooking, type GoogleBooking } from "@/lib/server/google-booking";

export const dynamic = "force-dynamic";
type Booking = { id: string; status: string; requester_calendar_id: string | null; request_mode: "google" | "manual"; requester_email: string; requester_name: string; purpose: string; location: string; confirmed_start: string; confirmed_end: string; google_event_id: string; google_event_url: string | null };
const claimMessages: Record<string, string> = {
  request_not_found: "요청을 찾을 수 없습니다.", request_not_pending: "수락할 수 없는 요청입니다.",
  other_approval_pending: "다른 요청의 일정 등록이 아직 처리 중입니다. ‘등록 결과 확인’을 먼저 눌러 완료해 주세요.",
  approval_busy: "일정을 등록하고 있습니다. 잠시 후 등록 결과를 확인해 주세요.",
  approval_slot_locked: "등록 중인 시간은 바꿀 수 없습니다. 먼저 등록 결과를 확인해 주세요.",
  invalid_candidate: "지났거나 유효하지 않은 후보입니다. 다른 시간을 선택해 주세요.",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "owner") return jsonError("일정 소유자 로그인이 필요합니다.", 401);
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return jsonError("요청을 찾을 수 없습니다.", 404);
  let start: string;
  try {
    const body = await request.json();
    if (typeof body?.start !== "string" || !Number.isFinite(Date.parse(body.start))) throw new Error();
    start = new Date(body.start).toISOString();
  } catch { return jsonError("수락할 시간을 선택해 주세요.", 400); }
  const db = supabaseAdmin(); const attempt = randomUUID();
  let booking: Booking | null = null;
  // A previous attempt may already have created the event. Never unlock its slot until Google confirms otherwise.
  let knownAbsent = false; let insertionAttempted = false;
  try {
    const { data: owner, error: ownerError } = await db.from("owner_calendars").select("encrypted_refresh_token,calendar_write_enabled").eq("google_sub", session.sub).single();
    if (ownerError || !owner) return jsonError("호스트 캘린더 연결을 확인해 주세요.", 409);
    if (!owner.calendar_write_enabled) return NextResponse.json({ error: "일정을 등록하려면 Google 일정 등록 권한을 연결해 주세요.", reconnect: true }, { status: 403 });
    const { data, error } = await db.rpc("reserve_meeting_approval", { p_owner_sub: session.sub, p_request_id: id, p_start: start, p_attempt: attempt });
    if (error) return jsonError(claimMessages[error.message] ?? "요청 상태를 확인하지 못했습니다. 다시 시도해 주세요.", error.message === "request_not_found" ? 404 : 409);
    booking = data as Booking;
    if (booking.status === "approved") return NextResponse.json({ status: "approved", url: booking.google_event_url, start: booking.confirmed_start, end: booking.confirmed_end });
    const accessToken = await refreshGoogleAccessToken(owner.encrypted_refresh_token);
    let event: GoogleBooking | null = await findGoogleBooking(accessToken, booking.google_event_id);
    knownAbsent = event === null;
    if (!event) {
      const from = new Date(Date.parse(booking.confirmed_start) - 86_400_000);
      const until = new Date(Date.parse(booking.confirmed_end) + 86_400_000);
      const ownerEvents = await getCalendarEvents(owner.encrypted_refresh_token, from, until);
      let requesterEvents: Awaited<ReturnType<typeof getCalendarEvents>> = [];
      if (booking.request_mode !== "manual") {
        if (!booking.requester_calendar_id) throw new Error("requester_calendar_missing");
        const { data: requester, error: requesterError } = await db.from("requester_calendars").select("encrypted_refresh_token,google_sub").eq("id", booking.requester_calendar_id).single();
        if (requesterError || !requester) throw new Error("requester_calendar_missing");
        const {data: currentConnection} = await db.from("owner_calendars").select("encrypted_refresh_token").eq("google_sub",requester.google_sub).not("account_id","is",null).maybeSingle();
        requesterEvents = await getCalendarEvents(currentConnection?.encrypted_refresh_token ?? requester.encrypted_refresh_token, from, until);
      }
      if (Date.parse(booking.confirmed_start) <= Date.now() || !slotIsAvailable([...ownerEvents, ...requesterEvents], new Date(booking.confirmed_start), new Date(booking.confirmed_end), booking.location)) {
        throw new Error("new_conflict");
      }
      // Re-check our lease after remote calendar reads, before the irreversible Google call.
      const { data: lease, error: leaseError } = await db.from("meeting_requests").update({ approval_locked_until: new Date(Date.now() + 120_000).toISOString() }).eq("id", id).eq("approval_attempt", attempt).eq("status", "confirming").select("id").maybeSingle();
      if (leaseError || !lease) throw new Error("approval_lease_lost");
      insertionAttempted = true;
      event = await insertGoogleBooking(accessToken, { id: booking.google_event_id, requestId: id, purpose: booking.purpose, name: booking.requester_name, email: booking.requester_email, location: booking.location, start: booking.confirmed_start, end: booking.confirmed_end });
    }
    if (event.status === "cancelled" || event.extendedProperties?.private?.caltalkRequestId !== id || Date.parse(event.start?.dateTime ?? "") !== Date.parse(booking.confirmed_start) || Date.parse(event.end?.dateTime ?? "") !== Date.parse(booking.confirmed_end)) {
      knownAbsent = false;
      throw new Error("event_changed");
    }
    const { data: saved, error: saveError } = await db.from("meeting_requests").update({ status: "approved", google_event_url: event.htmlLink ?? null, approval_locked_until: null }).eq("id", id).eq("approval_attempt", attempt).eq("status", "confirming").select("id").maybeSingle();
    if (saveError || !saved) throw new Error("approval_save_failed");
    return NextResponse.json({ status: "approved", url: event.htmlLink ?? null, start: booking.confirmed_start, end: booking.confirmed_end });
  } catch (cause) {
    if (booking?.status === "confirming") {
      const safeToReset = knownAbsent && (!insertionAttempted || (cause instanceof CalendarWriteError && !cause.uncertain));
      const changedExternally = cause instanceof Error && cause.message === "event_changed";
      await db.from("meeting_requests").update(changedExternally ? { status: "calendar_conflict", approval_locked_until: null } : safeToReset ? { status: "needs_owner_review", confirmed_start: null, confirmed_end: null, google_event_id: null, approval_locked_until: null } : { approval_locked_until: null }).eq("id", id).eq("approval_attempt", attempt).eq("status", "confirming");
    }
    if (cause instanceof CalendarWriteError && [401, 403].includes(cause.status)) return NextResponse.json({ error: "Google 일정 등록 권한을 다시 연결해 주세요.", reconnect: true }, { status: 403 });
    if (cause instanceof Error && cause.message === "new_conflict") return jsonError("선택한 시간이 지났거나 새로운 일정/이동 여유와 겹칩니다. 다른 후보를 선택해 주세요.", 409);
    if (cause instanceof Error && cause.message === "event_changed") return jsonError("Google에 등록된 일정이 변경되거나 삭제되어 자동 복구할 수 없습니다. Google Calendar에서 확인해 주세요.", 409);
    return jsonError("일정 등록을 완료하지 못했습니다. ‘등록 결과 확인’ 또는 수락 버튼으로 다시 시도해 주세요. 이미 생성된 일정은 중복 등록하지 않습니다.", 502);
  }
}
