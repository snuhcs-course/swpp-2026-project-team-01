import { z } from "zod"
import { FILTER_KEYS } from "@/core/types"
import { body, handle, type Ctx } from "@/server/api"
import { currentUser, db, now } from "@/server/context"
import { removeFilterKey } from "@/server/services/chat"

export function PATCH(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    const { remove } = await body(req, z.object({ remove: z.enum(FILTER_KEYS as [string, ...string[]]) }))
    const user = await currentUser()
    return Response.json(await removeFilterKey(db(), id, user.id, remove as (typeof FILTER_KEYS)[number], now()))
  })
}
