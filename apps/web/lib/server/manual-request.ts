// AI provenance: OpenAI Codex; initially generated 2026-10-05 (Asia/Seoul); scope: file.
import { createHash } from "node:crypto";
import { getCalendarEvents, labelSlot, slotIsAvailable, suggestSlots, supabaseAdmin } from "./auth";
import { linkIsOpen, seoulDay, type TimeWindow } from "@/lib/availability";

export async function manualOptions(code: string, location: string, requestedDuration: number) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(code)) throw new Error("invalid_link");
  const { data: link, error } = await supabaseAdmin().from("share_links")
    .select("id,active,deleted_at,availability_end,availability_windows,meeting_duration_minutes,owner_calendars(encrypted_refresh_token)")
    .eq("code_hash", createHash("sha256").update(code).digest("hex")).maybeSingle();
  if (error) throw error;
  if (!link || !linkIsOpen(link)) throw new Error("invalid_link");
  const duration = link.meeting_duration_minutes ?? requestedDuration;
  if (![30,45,60,90,120,180,240].includes(duration)) throw new Error("invalid_duration");
  if (!link.meeting_duration_minutes && ![30,45,60,90].includes(duration)) throw new Error("invalid_duration");
  const owner = Array.isArray(link.owner_calendars) ? link.owner_calendars[0] : link.owner_calendars;
  if (!owner) throw new Error("calendar_missing");
  const events = await getCalendarEvents(owner.encrypted_refresh_token, seoulDay(0), seoulDay(16));
  const windows = link.availability_windows as TimeWindow[] | null;
  const slots = link.meeting_duration_minutes && windows
    ? windows.filter(slot => Date.parse(slot.start) > Date.now() && slotIsAvailable(events, new Date(slot.start), new Date(slot.end), location))
    : suggestSlots(events, [], duration, location, windows);
  return { linkId: link.id, duration, slots: slots.map((slot, index) => ({
    start: slot.start, end: slot.end, label: labelSlot(slot.start), rank: index + 1,
    reason: "요청자가 직접 선택한 시간입니다. 호스트 일정과 이동 여유만 확인했으며 요청자의 캘린더는 확인하지 않았습니다.",
  })) };
}
