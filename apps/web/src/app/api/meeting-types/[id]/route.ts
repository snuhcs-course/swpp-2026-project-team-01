import { z } from "zod"
import { body, fail, handle, type Ctx } from "@/server/api"
import { currentUser, db } from "@/server/context"
import { deleteMeetingType, updateMeetingType } from "@/server/repos/hosting"

const schema = z.object({ name: z.string().trim().min(1).max(60), durationMin: z.number().int().min(5).max(480) })

export function PATCH(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    const input = await body(req, schema)
    return (await updateMeetingType(db(), (await currentUser(req)).id, id, input)) ? Response.json({ ok: true }) : fail("not_found", "양식을 찾을 수 없어요")
  })
}

export function DELETE(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    return (await deleteMeetingType(db(), (await currentUser(req)).id, id)) ? Response.json({ ok: true }) : fail("not_found", "양식을 찾을 수 없어요")
  })
}
