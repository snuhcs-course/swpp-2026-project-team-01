import { fail, handle, type Ctx } from "@/server/api"
import { currentUser, db } from "@/server/context"
import { deleteEvent } from "@/server/repos/events"

export function DELETE(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    const ok = await deleteEvent(db(), (await currentUser()).id, id)
    return ok ? Response.json({ ok: true }) : fail("not_found", "삭제할 수 없는 일정이에요 (수락된 미팅은 요청에서만 바꿀 수 있어요)")
  })
}
