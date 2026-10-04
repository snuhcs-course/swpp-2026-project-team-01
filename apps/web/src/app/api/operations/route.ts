import { requireActor } from "@/server/session"
import { db } from "@/server/context"
import { makeContext } from "@/server/runtime"
import { handleCommand, jsonResult, operationKey, commandBody } from "@/server/command-api"
import { readOperation } from "@/server/services/operations"
import { idSchema } from "@/contracts/common"
export const GET = (req:Request) => handleCommand(async()=>{const actor=await requireActor(req);const params=new URL(req.url).searchParams;return jsonResult(readOperation(makeContext(db()),actor.id,{kind:idSchema.parse(params.get("kind")),key:idSchema.parse(params.get("key"))}))})
