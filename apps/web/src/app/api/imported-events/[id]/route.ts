import {requireActor} from '@/server/session'
import {db} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {handleCommand,jsonResult} from '@/server/command-api'
import {getImportedEventDetail} from '@/server/services/annotations'
export function GET(req:Request,{params}:{params:Promise<{id:string}>}){return handleCommand(async()=>{const actor=await requireActor(req),{id}=await params;return jsonResult(await getImportedEventDetail(makeContext(db()),actor.id,id))})}
