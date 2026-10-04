import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl, decryptToken, encryptToken, getCalendarEvents, getSession, jsonError, supabaseAdmin } from "@/lib/server/auth";
import { insideWindows, ownerAvailability, seoulDay } from "@/lib/availability";
import { readPreview } from "@/lib/server/link-preview";
import { validateLinkOptions } from "@/lib/link-options";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "owner") return jsonError("일정 소유자 로그인이 필요합니다.", 401);
  try {
    const { data, error } = await supabaseAdmin().from("share_links").select(`
      id,name,active,created_at,encrypted_code,availability_start,availability_end,availability_windows,meeting_duration_minutes,publication_settings,
      meeting_requests(id,requester_name,requester_email,purpose,created_at,duration_minutes,location,candidate_slots,status,confirmed_start,confirmed_end,google_event_url)
    `).eq("owner_google_sub", session.sub).is("deleted_at", null).order("created_at", { ascending: false });
    if (error) throw error;
    const links = (data ?? []).map(({ encrypted_code, ...link }) => {
      let url: string | null = null;
      if (encrypted_code) { try { url = appUrl(`/request/${decryptToken(encrypted_code)}`); } catch { /* Keep link management available after key rotation. */ } }
      return { ...link, url };
    });
    const { data: owner, error: ownerError } = await supabaseAdmin().from("owner_calendars").select("calendar_write_enabled").eq("google_sub", session.sub).single();
    if (ownerError) throw ownerError;
    return NextResponse.json({ links, calendarWriteEnabled: !!owner?.calendar_write_enabled }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return jsonError("요청 링크를 불러오지 못했습니다. 다시 시도해 주세요.", 500); }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "owner") return jsonError("일정 소유자 로그인이 필요합니다.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("링크 이름을 입력해 주세요.", 400); }
  const name = body && typeof body === "object" && "name" in body && typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return jsonError("링크 이름을 1~80자로 입력해 주세요.", 400);
  let preview; let selected;
  try {
    const input = body as { preview?: unknown; selectedStarts?: unknown };
    preview = readPreview(input.preview, session.sub);
    validateLinkOptions(preview.options);
    if (!Array.isArray(input.selectedStarts) || input.selectedStarts.length < 2 || input.selectedStarts.length > 5 || new Set(input.selectedStarts).size !== input.selectedStarts.length) throw new Error("후보를 2개 이상 선택해 주세요.");
    selected = preview.candidates.filter((slot) => (input.selectedStarts as unknown[]).includes(slot.start));
    if (selected.length !== input.selectedStarts.length) throw new Error("제시된 후보 중에서 선택해 주세요.");
  } catch (cause) { return jsonError(cause instanceof Error ? cause.message : "후보를 다시 조회해 주세요.", 400); }
  try {
    const db = supabaseAdmin();
    const { data: owner, error: ownerError } = await db.from("owner_calendars").select("encrypted_refresh_token").eq("google_sub", session.sub).single();
    if (ownerError || !owner) return jsonError("Google Calendar를 다시 연결해 주세요.", 409);
    const now = Date.now();
    let events;
    try { events = await getCalendarEvents(owner.encrypted_refresh_token, seoulDay(0, 0, 0, now), seoulDay(16, 0, 0, now)); }
    catch { return jsonError("공개할 시간을 확인하지 못했습니다. 캘린더 연결을 확인하고 다시 시도해 주세요.", 502); }
    const windows = ownerAvailability(events, now);
    if (selected.some((slot) => !insideWindows(new Date(slot.start), new Date(slot.end), windows))) return jsonError("선택한 시간에 새 일정이 생겼습니다. 후보를 다시 조회해 주세요.", 409);
    const code = randomBytes(24).toString("base64url");
    const { data, error } = await db.from("share_links").insert({
      code_hash: createHash("sha256").update(code).digest("hex"), encrypted_code: encryptToken(code),
      owner_google_sub: session.sub, name, availability_start: selected[0].start, availability_end: selected[selected.length - 1].end, availability_windows: selected,
      meeting_duration_minutes: preview.options.duration, publication_settings: preview.options,
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ id: data.id, url: appUrl(`/request/${code}`) }, { status: 201 });
  } catch { return jsonError("요청 링크를 만들지 못했습니다.", 500); }
}
