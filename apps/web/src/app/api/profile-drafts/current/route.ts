import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { handleCommand, jsonResult, operationKey, commandBody } from "@/server/command-api"
import { currentDraft } from "@/server/services/profile"
export const GET = (req:Request) => handleCommand(async()=>{ const actor=await requireActor(req); return jsonResult(await currentDraft(db(),actor.id)) })
