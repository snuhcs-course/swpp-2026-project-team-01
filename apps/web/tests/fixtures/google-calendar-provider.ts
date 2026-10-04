import { emptyDb } from '../server/helpers'
import { makeContext } from '@/server/runtime'
import { GoogleCalendarProvider } from '@/server/providers/google-calendar'

export const NOW = Date.parse('2026-10-04T15:00:00Z')
export const event = (id = 'event', overrides: Record<string, unknown> = {}) => ({
  id, summary: 'Planning', status: 'confirmed', start: { dateTime: '2026-10-05T01:00:00Z' },
  end: { dateTime: '2026-10-05T02:00:00Z' }, location: 'Room A', ...overrides,
})
export async function fixture() {
  const { db, sqlite } = await emptyDb()
  let now = NOW, sequence = 0
  const ctx = makeContext(db, { now: () => now }, { mode: 'demo',  allowReset: false })
  ctx.id = () => `generated-${++sequence}`
  ;(await sqlite.exec(`INSERT INTO users(id,name,calendar_use_state) VALUES ('owner','Owner','needs_refresh'),('other','Other','manual');
    INSERT INTO calendar_connections(id,user_id,subject,status) VALUES ('connection','owner','subject','connected');
    INSERT INTO calendar_sources(id,connection_id,provider_calendar_id,name,timezone,access_role,selected)
    VALUES ('source-a','connection','a@example.test','A','Asia/Seoul','owner',1),('source-b','connection','b','B','UTC','freeBusyReader',1);`))
  const requests: { url: URL; init?: RequestInit }[] = []
  let responder: (url: URL, init?: RequestInit) => unknown | Promise<unknown> = url => url.pathname.endsWith('/calendarList')
    ? { items: [{ id: 'a@example.test', summary: 'A', timeZone: 'Asia/Seoul', accessRole: 'owner' }, { id: 'b', summary: 'B', timeZone: 'UTC', accessRole: 'freeBusyReader' }] }
    : url.pathname.endsWith('/freeBusy') ? { calendars: { b: { busy: [] } } } : { items: [event()] }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init })
    const data = await responder(url, init)
    return data instanceof Response ? data : Response.json(data)
  }
  const port = new GoogleCalendarProvider({ accessToken: async () => 'fixture-access', fetch: fetcher, now: () => now })
  return { ctx, sqlite, port, requests, respond: (fn: typeof responder) => { responder = fn }, advance: (ms: number) => { now += ms }, close: () => sqlite.close() }
}
