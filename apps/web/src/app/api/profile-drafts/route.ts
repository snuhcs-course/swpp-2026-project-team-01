import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { handleCommand, jsonResult, operationKey, commandBody } from "@/server/command-api"
import { createDraft } from "@/server/services/profile"
import { createDraftSchema } from "@/contracts/profile"
export const POST = (req:Request) => handleCommand(async()=>{ const actor=await requireActor(req); const input=await commandBody(req,createDraftSchema); return jsonResult(await createDraft(makeContext(db()),actor.id,input,operationKey(req)),201) })
