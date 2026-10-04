import {requireActor} from '@/server/session'
import {db,llm} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {commandBody,handleCommand,jsonResult,operationKey} from '@/server/command-api'
import {acceptRequestSchema} from '@/contracts/booking'
import {acceptMeeting} from '@/server/services/booking-commands'
export function POST(req:Request,{params}:{params:Promise<{id:string}>}){return handleCommand(async()=>{const actor=await requireActor(req),{id}=await params;return jsonResult(await acceptMeeting(makeContext(db()),actor.id,{requestId:id,...await commandBody(req,acceptRequestSchema)},operationKey(req)))})}
