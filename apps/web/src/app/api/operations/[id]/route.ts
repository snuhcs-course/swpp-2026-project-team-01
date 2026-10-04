import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { handleCommand, jsonResult, operationKey, commandBody } from "@/server/command-api"
import { readOperation } from "@/server/services/operations"
export const GET = (req:Request,route:{params:Promise<{id:string}>}) => handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(readOperation(makeContext(db()),actor.id,{id:(await route.params).id}))})
