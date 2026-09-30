import { computeSlots } from "@/core/slots"
import type { MeetingType, Person, Place, Slot } from "@/core/types"
import type { Db } from "../db/client"
import { listEvents } from "../repos/events"
import { listMeetingTypes, listPlaces } from "../repos/hosting"
import { getRules } from "../repos/users"

export async function loadPerson(db: Db, userId: string): Promise<Person> {
  return { events: await listEvents(db, userId), rules: await getRules(db, userId) }
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
