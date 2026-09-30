import { MIN_MS, kstDayStart } from "./time"
import type { Filter, RankedSlot } from "./types"

export const MAX_BUTTONS = 3
/** Buttons on the same day must start at least this far apart, so they are real alternatives. */
export const MIN_BUTTON_GAP_MIN = 60
const EPS = 1e-9

export type OptionsReason = "requested" | "few" | "settled"

/**
 * Top `n` by rank, skipping candidates that start within an hour of one already picked on the same day
 * (same start time with another place or length included). Falls back to plain rank order to fill up to `n`.
 */
export function pickDiverse(ranked: RankedSlot[], n: number = MAX_BUTTONS): RankedSlot[] {
  const gap = MIN_BUTTON_GAP_MIN * MIN_MS
  const picked: RankedSlot[] = []
  for (const r of ranked) {
    if (picked.length === n) break
    const tooClose = picked.some((p) => Math.abs(p.slot.startMs - r.slot.startMs) < gap && sameDay(p.slot.startMs, r.slot.startMs))
    if (!tooClose) picked.push(r)
  }
  for (const r of ranked) {
    if (picked.length === n) break
    if (!picked.includes(r)) picked.push(r)
  }
  return picked
}

function sameDay(a: number, b: number): boolean {
  return kstDayStart(a) === kstDayStart(b)
}

export interface OptionsDecision {
  show: boolean
  reason: OptionsReason | null
  top: RankedSlot[]
}

/**
 * Show the top-3 buttons when the user asked for them, when at most 3 slots remain, or when the
 * top 3 are settled: the 3rd and 4th scores differ, or an explicit order breaks every tie.
 */
export function decideOptions(ranked: RankedSlot[], filter: Filter, requested: boolean): OptionsDecision {
  const top = pickDiverse(ranked)
  if (ranked.length === 0) return { show: false, reason: null, top }
  if (requested) return { show: true, reason: "requested", top }
  if (ranked.length <= MAX_BUTTONS) return { show: true, reason: "few", top }
  if (filter.order !== undefined || Math.abs(ranked[2].score - ranked[3].score) > EPS) {
    return { show: true, reason: "settled", top }
  }
  return { show: false, reason: null, top }
}
