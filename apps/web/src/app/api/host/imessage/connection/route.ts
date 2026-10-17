import { z } from "zod"
import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { commandBody, handleCommand, jsonResult } from "@/server/command-api"
import { getConnection, startConnection } from "@/server/services/imessage"

const inputSchema = z.strictObject({ phone: z.string().trim().min(1).max(40) })

export function POST(request: Request) { return handleCommand(async () => {
  const actor = await requireActor(request), ctx = makeContext(db())
  const { phone } = await commandBody(request, inputSchema)
  return jsonResult(await startConnection(ctx, actor.id, phone), 202)
}) }

export function GET(request: Request) { return handleCommand(async () => {
  const actor = await requireActor(request), ctx = makeContext(db())
  return jsonResult({ connection: await getConnection(ctx, actor.id) })
}) }
