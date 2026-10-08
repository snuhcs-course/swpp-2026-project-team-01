// AI-generated with OpenAI Codex, 2026-10-05.
import { NextResponse } from "next/server";
import { getSession, jsonError, supabaseAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function update(request: Request, context: Context, deleting: boolean) {
  const session = await getSession();
  if (!session || session.role !== "owner") return jsonError("일정 소유자 로그인이 필요합니다.", 401);
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return jsonError("링크를 찾을 수 없습니다.", 404);
  let active = false;
  if (!deleting) {
    let body: unknown;
    try { body = await request.json(); } catch { return jsonError("변경할 상태를 확인해 주세요.", 400); }
    if (!body || typeof body !== "object" || !("active" in body) || typeof body.active !== "boolean") return jsonError("변경할 상태를 확인해 주세요.", 400);
    active = body.active;
  }
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.rpc("manage_share_link", { p_owner_sub: session.sub, p_link_id: id, p_active: active, p_delete: deleting });
    if (error?.message === "link_approval_pending") return jsonError("등록 중인 요청의 결과를 먼저 확인한 뒤 링크를 삭제해 주세요.", 409);
    if (error && ["link_not_found", "link_expired"].includes(error.message)) return jsonError("링크가 없거나 공개 기간이 끝났습니다.", 404);
    if (error) throw error;
    if (!data) return jsonError("링크가 없거나 공개 기간이 끝났습니다.", 404);
    return NextResponse.json({ link: data });
  } catch { return jsonError("링크 상태를 변경하지 못했습니다. 다시 시도해 주세요.", 500); }
}

export async function PATCH(request: Request, context: Context) { return update(request, context, false); }
export async function DELETE(request: Request, context: Context) { return update(request, context, true); }
