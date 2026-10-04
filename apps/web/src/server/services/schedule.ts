import {projectAnnotation,type AnnotationProjection} from '@/core/annotations'
import { DomainError } from "@/contracts/common"
import { normalizeCalendarEvents, type CalendarSourceInput } from "@/core/calendar"
import { computeSlots } from "@/core/slots"
import type { MeetingType, Person, Place, Slot } from "@/core/types"
import { all, one, type Db } from "../db/client"
import { listEvents } from "../repos/events"
import { listMeetingTypes, listPlaces } from "../repos/hosting"
import { getRules } from "../repos/users"

export async function loadPerson(db: Db, userId: string): Promise<Person> {
  const events = await listEvents(db, userId)
  const state = await one<{ calendar_use_state: string; status: string | null; schedule_snapshot_id: string | null }>(db, "SELECT u.calendar_use_state,c.status,c.schedule_snapshot_id FROM users u LEFT JOIN calendar_connections c ON c.user_id=u.id WHERE u.id=?", [userId])
  if (state && !['manual', 'not_connected'].includes(state.calendar_use_state) && (state.calendar_use_state !== 'connected' || state.status !== 'connected' || !state.schedule_snapshot_id)) throw new DomainError('calendar_decision_required', 'Calendar 연결과 가져오기 상태를 확인해 주세요')
  const connected = !!state?.schedule_snapshot_id && state.calendar_use_state === 'connected'
  const imported: CalendarSourceInput[] = []
  if (connected) {
    const rows = await all<{ field_fingerprints_json: string }>(db, "SELECT e.field_fingerprints_json FROM imported_events e JOIN calendar_sources s ON s.provider_calendar_id=e.calendar_id JOIN calendar_connections c ON c.id=s.connection_id WHERE c.user_id=? AND e.snapshot_id=? AND s.selected=1", [userId, state!.schedule_snapshot_id])
    for (const row of rows) {
      const source = JSON.parse(row.field_fingerprints_json).source as CalendarSourceInput
      const [calendarId, eventId] = JSON.parse(source.sourceKey) as string[]
      const annotation = await one<AnnotationProjection>(db, "SELECT a.* FROM event_annotations a JOIN calendar_connections c ON c.id=a.connection_id WHERE c.user_id=? AND a.calendar_id=? AND a.provider_event_id=?", [userId, calendarId, eventId])
      imported.push(projectAnnotation(row.field_fingerprints_json, annotation))
    }
  }
  const busy: CalendarSourceInput[] = connected
    ? (await all<{ id: string; start_at: number; end_at: number }>(db, "SELECT id,start_at,end_at FROM imported_busy_intervals WHERE snapshot_id=?", [state!.schedule_snapshot_id])).map((row) => ({ sourceKey: row.id, startMs: row.start_at, endMs: row.end_at, eventType: 'freeBusy' as const }))
    : []
  const normalized = normalizeCalendarEvents([...events.map((e) => ({ ...e, sourceKey: `app:${e.id}` })), ...imported, ...busy])
  return { events, rules: await getRules(db, userId), busyIntervals: normalized.busyIntervals, travelAnchors: normalized.travelAnchors }
}

export interface Bookable {
  slots: Slot[]
  places: Place[]
  meetingTypes: MeetingType[]
}

/** All slots the client and host can both attend. Accepted meetings are events, so they already block time. */
export async function computeBookable(db: Db, clientId: string, hostId: string, nowMs: number, minLeadHours?: number): Promise<Bookable> {
  const places = await listPlaces(db, hostId)
  const meetingTypes = await listMeetingTypes(db, hostId)
  const slots = computeSlots({
    host: await loadPerson(db, hostId),
    client: await loadPerson(db, clientId),
    places,
    meetingTypes,
    nowMs,
    minLeadHours,
  })
  return { slots, places, meetingTypes }
}

export async function isBookableHost(db: Db, hostId: string): Promise<boolean> {
  return (await listPlaces(db, hostId)).length > 0 && (await listMeetingTypes(db, hostId)).length > 0
}
