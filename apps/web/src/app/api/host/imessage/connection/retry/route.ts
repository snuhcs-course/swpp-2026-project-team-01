import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { handleCommand, jsonResult } from "@/server/command-api"
import { retryConnection } from "@/server/services/imessage"

export function POST(request: Request) { return handleCommand(async () => {
  const actor = await requireActor(request), ctx = makeContext(db())
  return jsonResult(await retryConnection(ctx, actor.id), 202)
}) }
