import { requireActor } from '@/server/session'
import { db } from '@/server/context'
import { makeContext } from '@/server/runtime'
import { handleCommand,jsonResult,commandBody,operationKey } from '@/server/command-api'
import { calendarProvider } from '@/server/calendar-context'
import {readCalendarConnection} from '@/server/services/calendar-sync'
export function GET(req:Request){return handleCommand(async()=>{const actor=await requireActor(req);return jsonResult(await readCalendarConnection(db(),actor.id))})}
