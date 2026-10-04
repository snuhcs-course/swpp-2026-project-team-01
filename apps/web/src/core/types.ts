import type { WeeklyWindow } from "./profile"
import type { BusyInterval, TravelAnchor } from "./calendar"

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
  /** When provided, these replace the corresponding legacy event-derived inputs. */
  busyIntervals?: BusyInterval[]
  travelAnchors?: TravelAnchor[]
  /** Explicit empty windows means unavailable; omission uses legacy rules. */
  windows?: WeeklyWindow[]
}

export interface Slot {
  startMs: number
  endMs: number
  placeId: string
  meetingTypeId: string
  /** Spare minutes to the nearest neighbouring event after travel time, capped. Used for the "slack" preference. */
  slackMin: number
  /** Exact common spare milliseconds. Optional only for legacy callers. */
  slackMs?: number
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
  outcome?: "available" | "preference_mismatch" | "must_no_results" | "no_availability"
  topClientScoreUnits?: number | null
  topHostScoreUnits?: number | null
  topScore: number | null
  tieCountAtTop: number
  /** Filled when count is 0: how many slots would exist if a single filter key were dropped. */
  relax: Partial<Record<FilterKey, number>>
}

export interface RankedSlot {
  slot: Slot
  /** Legacy display score; comparisons use integer units. */
  score: number
  clientScoreUnits?: number
  hostScoreUnits?: number
}

export interface RequestLike {
  id: string
  startMs: number
  endMs: number
  status: "pending" | "accepted" | "declined" | "withdrawn"
}

/** Canonical persisted override shape. */
export type PreferenceOverride<T> =
  | { state: "inherit" }
  | { state: "override"; value: T }
  | { state: "disabled" }

/** Read compatibility for the early core draft; new storage must use state. */
export type LegacyPreferenceOverride<T> =
  | { source: "inherit" }
  | { source: "override"; value: T }
  | { source: "disabled" }

export type PreferenceSource = "inherit" | "override" | "disabled"
export type MeetingModeCondition = { value: "online" | "offline"; strength: Strength }
export type LocationCondition = NonNullable<Filter["places"]> | MeetingModeCondition
export interface PreferenceValues {
  weekdays: NonNullable<Filter["weekdays"]>
  timeOfDay: NonNullable<Filter["timeOfDay"]>
  location: LocationCondition
  meetingTypes: NonNullable<Filter["meetingTypes"]>
  dateRange: NonNullable<Filter["dateRange"]>
  order: NonNullable<Filter["order"]>
  slack: NonNullable<Filter["slack"]>
}
export type PreferenceDimension = keyof PreferenceValues
export type PreferenceOverrides = {
  [K in PreferenceDimension]?: PreferenceOverride<PreferenceValues[K]> | LegacyPreferenceOverride<PreferenceValues[K]>
} & {
  /** Compatibility alias; location takes precedence when both are supplied. */
  places?: PreferenceOverride<NonNullable<Filter["places"]>> | LegacyPreferenceOverride<NonNullable<Filter["places"]>>
}

/** Effective location is mutually exclusive: specific places replace inherited mode. */
export type EffectiveConditions = Omit<Filter, "places"> & {
  sources?: Partial<Record<PreferenceDimension, PreferenceSource>>
} & (
  | { places?: Filter["places"]; meetingMode?: never }
  | { places?: never; meetingMode: MeetingModeCondition }
)
