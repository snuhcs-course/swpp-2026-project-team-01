import { z } from "zod"
import { body, handle, type Ctx } from "@/server/api"
import { currentUser, db, llm, now } from "@/server/context"
import { runTurn } from "@/server/services/chat"

export function POST(req: Request, ctx: Ctx<{ id: string }>) {
  return handle(async () => {
    const { id } = await ctx.params
    const { text } = await body(req, z.object({ text: z.string().trim().min(1).max(500) }))
    const user = await currentUser()
    return Response.json(await runTurn(db(), llm(), { conversationId: id, clientId: user.id, text }, now()))
  })
}
