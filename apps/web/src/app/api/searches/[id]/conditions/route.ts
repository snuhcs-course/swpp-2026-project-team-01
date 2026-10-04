import {requireActor} from '@/server/session'
import {db,llm} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {commandBody,handleCommand,jsonResult,operationKey} from '@/server/command-api'
import {conditionsSchema} from '@/contracts/search'
import {changeConditions} from '@/server/services/search'
export function POST(req:Request,{params}:{params:Promise<{id:string}>}){return handleCommand(async()=>{const actor=await requireActor(req),{id}=await params;return jsonResult(await changeConditions({...makeContext(db()),llm:llm()},actor.id,{searchId:id,...await commandBody(req,conditionsSchema)},operationKey(req)))})}
