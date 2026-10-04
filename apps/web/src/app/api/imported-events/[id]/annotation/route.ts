import {requireActor} from '@/server/session'
import {db} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {handleCommand,jsonResult,commandBody,operationKey} from '@/server/command-api'
import {annotationSchema} from '@/contracts/calendar'
import {saveAnnotation} from '@/server/services/annotations'
export function POST(req:Request,{params}:{params:Promise<{id:string}>}){return handleCommand(async()=>{const actor=await requireActor(req),{id}=await params;return jsonResult(await saveAnnotation(makeContext(db()),actor.id,{eventId:id,...await commandBody(req,annotationSchema)},operationKey(req)))})}
