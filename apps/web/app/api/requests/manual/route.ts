// AI-generated with OpenAI Codex, 2026-10-05.
import { NextResponse } from "next/server";
import { manualOptions } from "@/lib/server/manual-request";
import { jsonError, supabaseAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "invalid_link" || message.includes("share_link_unavailable")) return jsonError("닫혔거나 사용할 수 없는 링크입니다.", 404);
  if (message === "invalid_duration") return jsonError("미팅 길이를 확인해 주세요.", 400);
  return jsonError("호스트의 가능 시간을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await manualOptions(url.searchParams.get("code") ?? "", (url.searchParams.get("location") ?? "").slice(0,200), Number(url.searchParams.get("duration") ?? 60));
    return NextResponse.json({ slots: result.slots, duration: result.duration }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("요청 내용을 확인해 주세요.", 400); }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const purpose = typeof body?.purpose === "string" ? body.purpose.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  if (!name || name.length > 100 || !purpose || purpose.length > 500 || location.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("이름, 이메일, 미팅 목적을 확인해 주세요.", 400);
  if (!Array.isArray(body.selectedStarts) || body.selectedStarts.length < 1 || body.selectedStarts.length > 3 || body.selectedStarts.some((s: unknown) => typeof s !== "string") || new Set(body.selectedStarts).size !== body.selectedStarts.length) return jsonError("가능한 시간을 1~3개 선택해 주세요.", 400);
  try {
    const result = await manualOptions(typeof body.code === "string" ? body.code : "", location, Number(body.duration));
    const selected = result.slots.filter(slot => body.selectedStarts.includes(slot.start)).map((slot, index) => ({ ...slot, rank: index + 1 }));
    if (selected.length !== body.selectedStarts.length) return jsonError("선택한 시간이 지났거나 호스트 일정이 변경됐습니다. 시간을 다시 조회해 주세요.", 409);
    const db = supabaseAdmin();
    const { count, error: countError } = await db.from("meeting_requests").select("id", { count: "exact", head: true }).eq("share_link_id", result.linkId).eq("requester_email", email).gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if (countError) throw countError;
    if ((count ?? 0) >= 5) return jsonError("요청을 여러 번 보냈습니다. 잠시 후 다시 시도해 주세요.", 429);
    const { data, error } = await db.from("meeting_requests").insert({
      share_link_id: result.linkId, requester_calendar_id: null, request_mode: "manual",
      requester_name: name, requester_email: email, purpose, location,
      duration_minutes: result.duration, candidate_slots: selected,
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) { return failure(error); }
}
