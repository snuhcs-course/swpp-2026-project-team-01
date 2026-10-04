import { z } from "zod"
import { body, fail, handle, type Ctx } from "@/server/api"
import { currentUser, db } from "@/server/context"
import { deletePlace, updatePlace } from "@/server/repos/hosting"

const schema = z.object({ kind: z.enum(["office_near", "special", "online"]), name: z.string().trim().min(1).max(60) })

export function PATCH(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    const input = await body(req, schema)
    return (await updatePlace(db(), (await currentUser(req)).id, id, input)) ? Response.json({ ok: true }) : fail("not_found", "장소를 찾을 수 없어요")
  })
}

export function DELETE(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    return (await deletePlace(db(), (await currentUser(req)).id, id)) ? Response.json({ ok: true }) : fail("not_found", "장소를 찾을 수 없어요")
  })
}
