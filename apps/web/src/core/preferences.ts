// AI-generated with Codex (gpt-6-astra), 2026-10-05
import type { ProfilePreferences } from "./profile"
import type { EffectiveConditions, PreferenceDimension, PreferenceOverrides, PreferenceValues, PreferenceSource } from "./types"

const DIMENSIONS: PreferenceDimension[] = ["weekdays", "timeOfDay", "location", "meetingTypes", "dateRange", "order", "slack"]
const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

/** Pure resolution; neither persisted overrides nor their snapshot are mutated or aliased. */
export function resolvePreferences(snapshot: ProfilePreferences, overrides: PreferenceOverrides): EffectiveConditions {
  const inherited: Partial<PreferenceValues> = {}
  if (snapshot.weekdays) inherited.weekdays = { days: snapshot.weekdays.value, strength: snapshot.weekdays.strength }
  if (snapshot.startTime) inherited.timeOfDay = { start: hm(snapshot.startTime.value.startMin), end: hm(snapshot.startTime.value.endMin), strength: snapshot.startTime.strength }
  if (snapshot.meetingMode) inherited.location = snapshot.meetingMode
  if (snapshot.slack) inherited.slack = snapshot.slack
  const values: Partial<PreferenceValues> = {}
  const sources: Partial<Record<PreferenceDimension, PreferenceSource>> = {}
  for (const dimension of DIMENSIONS) {
    const override = overrides[dimension] ?? (dimension === "location" ? overrides.places : undefined)
    const source = override ? ("state" in override ? override.state : override.source) : "inherit"
    sources[dimension] = source
    const value = source === "disabled" ? undefined : override && "value" in override ? override.value : inherited[dimension]
    if (value !== undefined) Object.assign(values, { [dimension]: structuredClone(value) })
  }
  const { location, ...filter } = values
  if (!location) return { ...filter, sources }
  return "placeIds" in location
    ? { ...filter, sources, places: location }
    : { ...filter, sources, meetingMode: location }
}
