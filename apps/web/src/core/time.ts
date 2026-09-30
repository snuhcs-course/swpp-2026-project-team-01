// All product time is Asia/Seoul. KST has no DST, so a fixed +09:00 offset is exact.
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000
export const MIN_MS = 60 * 1000
export const HOUR_MS = 60 * MIN_MS
export const DAY_MS = 24 * HOUR_MS
export const SLOT_STEP_MIN = 30
export const HORIZON_DAYS = 60
export const MIN_LEAD_HOURS = 2

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"]

export interface KstParts {
  year: number
  month: number
  day: number
  weekday: number
  minuteOfDay: number
}

export function kstParts(ms: number): KstParts {
  const d = new Date(ms + KST_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  }
}

/** Epoch ms of 00:00 KST on the day containing `ms`. */
export function kstDayStart(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS
}

const pad = (n: number) => String(n).padStart(2, "0")

export function kstDateString(ms: number): string {
  const p = kstParts(ms)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function kstTimeString(ms: number): string {
  const p = kstParts(ms)
  return `${pad(Math.floor(p.minuteOfDay / 60))}:${pad(p.minuteOfDay % 60)}`
}

/** Epoch ms of `YYYY-MM-DD` 00:00 KST. */
export function parseKstDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_OFFSET_MS
  return kstDateString(ms) === date ? ms : null
}

/** Minutes since midnight for `HH:MM` (24:00 allowed). */
export function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  if (!m) return null
  const min = Number(m[1]) * 60 + Number(m[2])
  return min >= 0 && min <= 24 * 60 && Number(m[2]) < 60 ? min : null
}

export function weekdayKo(weekday: number): string {
  return WEEKDAY_KO[weekday] ?? "?"
}

/** `M월 D일(요일) HH:MM` */
export function formatKstDateTime(ms: number): string {
  const p = kstParts(ms)
  return `${p.month}월 ${p.day}일(${weekdayKo(p.weekday)}) ${kstTimeString(ms)}`
}

/** Monday (KST) of the week containing `ms`, as `YYYY-MM-DD`. */
export function kstWeekStart(ms: number): string {
  const p = kstParts(ms)
  const back = (p.weekday + 6) % 7
  return kstDateString(kstDayStart(ms) - back * DAY_MS)
}
