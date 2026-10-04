import {requireActor} from '@/server/session'
import {db,llm} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {commandBody,handleCommand,jsonResult,operationKey} from '@/server/command-api'
import {createRequestSchema} from '@/contracts/booking'
import {requestMeeting} from '@/server/services/booking-commands'
export function POST(req:Request){return handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(await requestMeeting(makeContext(db()),actor.id,await commandBody(req,createRequestSchema),operationKey(req)),201)})}
