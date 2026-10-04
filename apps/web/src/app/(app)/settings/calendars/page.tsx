import {ImportedEvents} from '@/components/calendar/ImportedEvents'
import {currentUser,db} from '@/server/context'
import {makeContext} from '@/server/runtime'
import {readServerConfig} from '@/server/config'
import {readCalendarConnection} from '@/server/services/calendar-sync'
import {CalendarSettings} from '@/components/calendar/CalendarSettings'
export const metadata = { title: 'Calendar 연결' }
export default async function CalendarsPage(){const user=await currentUser();return <div className="space-y-6"><CalendarSettings initial={await readCalendarConnection(db(),user.id)} mode={readServerConfig().mode}/><ImportedEvents/></div>}
