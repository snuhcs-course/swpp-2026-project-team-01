/** KST weekday: 0 = Sunday … 6 = Saturday; half-open minutes within one day. */
export interface WeeklyWindow {
  weekday: number
  startMin: number
  endMin: number
}

export type Preference<T> = { value: T; strength: "strong" | "weak" } | null

export interface ProfilePreferences {
  weekdays: Preference<number[]>
  startTime: Preference<{ startMin: number; endMin: number }>
  meetingMode: Preference<"online" | "offline">
  slack: { strength: "strong" | "weak" } | null
}

export interface ProfileValues {
  work: { mode: "fixed" | "none"; windows: WeeklyWindow[] }
  meetingWindows: WeeklyWindow[]
  preferences: ProfilePreferences
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isWeekday(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6
}

function isMinuteRange(value: unknown): value is { startMin: number; endMin: number } {
  return isRecord(value)
    && typeof value.startMin === "number" && Number.isInteger(value.startMin)
    && typeof value.endMin === "number" && Number.isInteger(value.endMin)
    && value.startMin >= 0 && value.startMin < value.endMin && value.endMin <= 1440
}

function isWindow(value: unknown): value is WeeklyWindow {
  return isRecord(value) && isWeekday(value.weekday) && isMinuteRange(value)
}

/** Return a sorted union without mutating input. Cross-midnight input must be split by the caller. */
export function normalizeWindows(windows: WeeklyWindow[]): WeeklyWindow[] {
  if (!Array.isArray(windows) || !windows.every(isWindow)) {
    throw new RangeError("Windows require weekday 0–6 and integer minutes 0 <= startMin < endMin <= 1440.")
  }
  const sorted = windows.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin }))
    .sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin || a.endMin - b.endMin)
  const result: WeeklyWindow[] = []
  for (const window of sorted) {
    const previous = result.at(-1)
    if (previous && previous.weekday === window.weekday && window.startMin <= previous.endMin) {
      previous.endMin = Math.max(previous.endMin, window.endMin)
    } else {
      result.push(window)
    }
  }
  return result
}

/** Validate profile values only; draft topic confirmations are a separate contract concern. */
export function validateProfile(values: ProfileValues): { valid: boolean; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = Object.create(null)
  const error = (field: string, message: string) => {
    ;(fieldErrors[field] ??= []).push(message)
  }
  const result = () => ({ valid: Object.keys(fieldErrors).length === 0, fieldErrors })
  const checkKeys = (value: Record<string, unknown>, allowed: string[], path: string) => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) error(path ? `${path}.${key}` : key, "Unsupported profile field.")
    }
  }
  const checkWindows = (windows: unknown, path: string): windows is WeeklyWindow[] => {
    if (!Array.isArray(windows)) {
      error(path, "Expected an array of weekly windows.")
      return false
    }
    let valid = true
    for (const [index, window] of windows.entries()) {
      if (!isWindow(window)) {
        error(`${path}.${index}`, "Use weekday 0–6 and integer minutes 0 <= startMin < endMin <= 1440; split cross-midnight windows explicitly.")
        valid = false
      } else {
        checkKeys(window as unknown as Record<string, unknown>, ["weekday", "startMin", "endMin"], `${path}.${index}`)
      }
    }
    return valid
  }
  const checkPreference = (preference: unknown, key: string, accepts: (value: unknown) => boolean) => {
    const path = `preferences.${key}`
    if (preference === null) return
    if (!isRecord(preference)) {
      error(path, "Expected a preference or null.")
      return
    }
    checkKeys(preference, key === "slack" ? ["strength"] : ["value", "strength"], path)
    if (preference.strength !== "strong" && preference.strength !== "weak") {
      error(`${path}.strength`, "Default preference strength must be strong or weak.")
    }
    if (key !== "slack" && !accepts(preference.value)) {
      error(`${path}.value`, "Invalid preference value.")
    }
  }

  if (!isRecord(values)) {
    error("profile", "Expected profile values.")
    return result()
  }
  checkKeys(values, ["work", "meetingWindows", "preferences"], "")
  if (!isRecord(values.work)) {
    error("work", "Expected work mode and windows.")
  } else {
    checkKeys(values.work, ["mode", "windows"], "work")
    const validWindows = checkWindows(values.work.windows, "work.windows")
    if (values.work.mode !== "fixed" && values.work.mode !== "none") {
      error("work.mode", "Work mode must be fixed or none.")
    } else if (validWindows) {
      if (values.work.mode === "none" && values.work.windows.length !== 0) {
        error("work.windows", "No fixed work requires empty work windows.")
      }
      if (values.work.mode === "fixed" && values.work.windows.length === 0) {
        error("work.windows", "Fixed work requires at least one window; choose none otherwise.")
      }
    }
  }
  const validMeetingWindows = checkWindows(values.meetingWindows, "meetingWindows")
  if (!isRecord(values.preferences)) {
    error("preferences", "Expected all four preference fields, using null for no preference.")
    return result()
  }
  const preferences = values.preferences
  checkKeys(preferences, ["weekdays", "startTime", "meetingMode", "slack"], "preferences")
  checkPreference(preferences.weekdays, "weekdays", (value) => Array.isArray(value) && value.length > 0 && value.every(isWeekday) && new Set(value).size === value.length)
  checkPreference(preferences.startTime, "startTime", isMinuteRange)
  if (isRecord(preferences.startTime) && isRecord(preferences.startTime.value)) {
    checkKeys(preferences.startTime.value, ["startMin", "endMin"], "preferences.startTime.value")
  }
  checkPreference(preferences.meetingMode, "meetingMode", (value) => value === "online" || value === "offline")
  checkPreference(preferences.slack, "slack", () => true)

  // Combine both dimensions before testing overlap. Meeting length and slot grid are search concerns.
  const malformedTimePreference = Object.keys(fieldErrors).some((path) =>
    path.startsWith("preferences.weekdays") || path.startsWith("preferences.startTime"))
  if (validMeetingWindows && !malformedTimePreference && (preferences.weekdays || preferences.startTime)) {
    const days = preferences.weekdays?.value
    const range = preferences.startTime?.value
    const overlaps = values.meetingWindows.some((window) =>
      (!days || days.includes(window.weekday))
      && (!range || Math.max(range.startMin, window.startMin) < Math.min(range.endMin, window.endMin)))
    if (!overlaps) {
      const message = "Combined weekday and start-time preferences must overlap a meeting window; clear conflicting preferences when accepting no meetings."
      if (preferences.weekdays) error("preferences.weekdays", message)
      if (preferences.startTime) error("preferences.startTime", message)
    }
  }
  return result()
}
