export type LocationKind = "office" | "place" | "online" | "none"
export type PlaceKind = "office_near" | "special" | "online"
export type Role = "host" | "client"

export interface CalEvent {
  id: string
  title: string
  startMs: number
  endMs: number
  kind: LocationKind
  /** Place id or free-text place name; used only for the "same place" check. */
  placeRef: string | null
}

export interface Place {
  id: string
  kind: PlaceKind
  name: string
}

export interface MeetingType {
  id: string
  name: string
  durationMin: number
}

/** weekday: 0 = Sunday … 6 = Saturday (KST). Minutes are minutes since 00:00. */
export interface AvailabilityRule {
  weekday: number
  enabled: boolean
  startMin: number
  endMin: number
}

export interface Person {
  events: CalEvent[]
  rules: AvailabilityRule[]
}

export interface Slot {
  startMs: number
  endMs: number
  placeId: string
  meetingTypeId: string
  /** Spare minutes to the nearest neighbouring event after travel time, capped. Used for the "slack" preference. */
  slackMin: number
}

export type Strength = "must" | "strong" | "weak"

export interface Filter {
  dateRange?: { from: string; to: string; strength: Strength }
  weekdays?: { days: number[]; strength: Strength }
  timeOfDay?: { start: string; end: string; strength: Strength }
  places?: { placeIds: string[]; strength: Strength }
  meetingTypes?: { ids: string[]; strength: Strength }
  order?: "earliest" | "latest"
  slack?: { strength: "strong" | "weak" }
}

export type FilterKey = keyof Filter

export const FILTER_KEYS: FilterKey[] = [
  "dateRange",
  "weekdays",
  "timeOfDay",
  "places",
  "meetingTypes",
  "order",
  "slack",
]

export interface FilterChange {
  set?: Partial<Filter>
  remove?: FilterKey[]
}

export interface Summary {
  count: number
  firstDate: string | null
  lastDate: string | null
  byWeek: { weekStart: string; count: number }[]
  byWeekday: number[]
  byTimeOfDay: { morning: number; afternoon: number; evening: number }
  byPlace: Record<string, number>
  byMeetingType: Record<string, number>
  topScore: number | null
  tieCountAtTop: number
  /** Filled when count is 0: how many slots would exist if a single filter key were dropped. */
  relax: Partial<Record<FilterKey, number>>
}

export interface RankedSlot {
  slot: Slot
  score: number
}

export interface RequestLike {
  id: string
  startMs: number
  endMs: number
  status: "pending" | "accepted" | "declined" | "withdrawn"
}
