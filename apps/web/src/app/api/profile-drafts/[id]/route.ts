import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { handleCommand, jsonResult, operationKey, commandBody } from "@/server/command-api"
import { getDraft,patchDraft } from "@/server/services/profile"
import { patchDraftSchema } from "@/contracts/profile"
type RouteContext={params:Promise<{id:string}>}
export const GET = (req:Request,route:RouteContext) => handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(await getDraft(db(),actor.id,(await route.params).id))})
export const PATCH = (req:Request,route:RouteContext) => handleCommand(async()=>{const actor=await requireActor(req);const input=await commandBody(req,patchDraftSchema);return jsonResult(await patchDraft(makeContext(db()),actor.id,{...input,draftId:(await route.params).id},operationKey(req)))})
