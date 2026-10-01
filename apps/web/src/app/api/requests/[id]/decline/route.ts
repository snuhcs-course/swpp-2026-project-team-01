import { handle, type Ctx } from "@/server/api"
import { currentUser, db, now } from "@/server/context"
import { declineRequest } from "@/server/services/booking"

export function POST(_req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    const user = await currentUser()
    const result = await declineRequest(db(), id, user.id, now())
    return Response.json({ ok: true, ...(result ?? {}) })
  })
}
