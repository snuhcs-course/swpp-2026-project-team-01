import { requireActor } from '@/server/session'
import { db } from '@/server/context'
import { makeContext } from '@/server/runtime'
import { handleCommand,jsonResult,commandBody,operationKey } from '@/server/command-api'
import { calendarProvider } from '@/server/calendar-context'
import {syncSchema} from '@/contracts/calendar'
import {syncCalendar} from '@/server/services/calendar-sync'
export function POST(req:Request){return handleCommand(async()=>{const actor=await requireActor(req);const {scope,...input}=await commandBody(req,syncSchema);return jsonResult(await syncCalendar(makeContext(db()),actor.id,input,operationKey(req),calendarProvider(actor.id),scope??'full'))})}
