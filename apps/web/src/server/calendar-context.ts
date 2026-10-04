import { getDb } from './db/client'
import { readServerConfig } from './config'
import { GoogleCalendarProvider, type CalendarProvider } from './providers/google-calendar'
import { MockCalendarProvider } from './providers/mock-calendar'
import { authContext,refreshCalendarAccess } from './services/auth'
/** Real mode talks to Google. Demo mode never does: it answers from the schedule already set up for the account. */
export function calendarProvider(userId:string):CalendarProvider {
 if(readServerConfig().mode==='demo')return new MockCalendarProvider(getDb(),userId)
 return new GoogleCalendarProvider({accessToken:async()=> (await refreshCalendarAccess(authContext(),userId)).accessToken})
}
