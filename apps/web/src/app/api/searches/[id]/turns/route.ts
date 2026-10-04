import {requireActor} from '@/server/session'
import {db,llm} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {commandBody,handleCommand,jsonResult,operationKey} from '@/server/command-api'
import {searchTurnSchema} from '@/contracts/search'
import {searchTurn} from '@/server/services/search'
export function POST(req:Request,{params}:{params:Promise<{id:string}>}){return handleCommand(async()=>{const actor=await requireActor(req),{id}=await params;return jsonResult(await searchTurn({...makeContext(db()),llm:llm()},actor.id,{searchId:id,...await commandBody(req,searchTurnSchema)},operationKey(req)))})}
