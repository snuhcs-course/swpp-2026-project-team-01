import { requireActor } from '@/server/session'
import { db } from '@/server/context'
import { makeContext } from '@/server/runtime'
import { handleCommand,jsonResult,commandBody,operationKey } from '@/server/command-api'
import { calendarProvider } from '@/server/calendar-context'
import {disconnectSchema} from '@/contracts/calendar'
import {disconnectCalendar} from '@/server/services/calendar-sync'
export function POST(req:Request){return handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(await disconnectCalendar(makeContext(db()),actor.id,await commandBody(req,disconnectSchema),operationKey(req)))})}
