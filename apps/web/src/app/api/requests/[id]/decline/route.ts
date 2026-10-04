import {requireActor} from '@/server/session'
import {db,llm} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {commandBody,handleCommand,jsonResult,operationKey} from '@/server/command-api'
import {requestDecisionSchema} from '@/contracts/booking'
import {decideRequest} from '@/server/services/booking-commands'
export function POST(req:Request,{params}:{params:Promise<{id:string}>}){return handleCommand(async()=>{const actor=await requireActor(req),{id}=await params;return jsonResult(await decideRequest(makeContext(db()),actor.id,id,'decline',await commandBody(req,requestDecisionSchema),operationKey(req)))})}
