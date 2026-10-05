import {requireActor} from '@/server/session'
import {db} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {handleCommand,jsonResult} from '@/server/command-api'
import {listImportedEvents} from '@/server/services/annotations'
export function GET(req:Request){return handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(await listImportedEvents(makeContext(db()),actor.id))})}
