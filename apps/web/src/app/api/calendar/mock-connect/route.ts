import { requireActor } from '@/server/session'
import { db } from '@/server/context'
import { makeContext } from '@/server/runtime'
import { handleCommand,jsonResult,operationKey } from '@/server/command-api'
import { connectMockCalendar } from '@/server/services/mock-calendar'
export function POST(req:Request){return handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(await connectMockCalendar(makeContext(db()),actor.id,operationKey(req)))})}
