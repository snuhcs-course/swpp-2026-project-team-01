// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import { hostChatSendSchema } from "@/contracts/host-chat"
import { localeSchema } from "@/contracts/profile"
import { commandBody, handleCommand, jsonResult, operationKey } from "@/server/command-api"
import { db, llm } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { hostChatSend, hostChatView } from "@/server/services/host-chat"
import { requireActor } from "@/server/session"

/** The host chat as the screen draws it. `?locale=en|ko` picks the language of the lines written here. */
export function GET(req: Request) { return handleCommand(async () => {
  const actor = await requireActor(req)
  return jsonResult(await hostChatView(db(), actor.id, localeSchema.parse(new URL(req.url).searchParams.get("locale") ?? "en")))
}) }

/** One message or suggested reply from the host; answers with the new view. */
export function POST(req: Request) { return handleCommand(async () => {
  const actor = await requireActor(req)
  return jsonResult(await hostChatSend({ ...makeContext(db()), llm: llm() }, actor.id, await commandBody(req, hostChatSendSchema), operationKey(req)))
}) }
