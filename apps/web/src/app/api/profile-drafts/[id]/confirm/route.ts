// AI-generated with Codex (gpt-6-astra), 2026-10-05
import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { handleCommand, jsonResult, operationKey, commandBody } from "@/server/command-api"
import { confirmProfile } from "@/server/services/profile"
import { confirmProfileSchema } from "@/contracts/profile"
export const POST = (req:Request,route:{params:Promise<{id:string}>}) => handleCommand(async()=>{const actor=await requireActor(req);const input=await commandBody(req,confirmProfileSchema);return jsonResult(await confirmProfile(makeContext(db()),actor.id,{...input,draftId:(await route.params).id},operationKey(req)))})
