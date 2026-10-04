import type { AnalysisEvent as NormalizedEvent } from './calendar'
import { kstParts, type TimeRange } from './time'
export type Classification = 'business' | 'personal' | 'unknown'
export interface AnalysisEvent extends NormalizedEvent {
 classification?: Classification; userClassification?: Classification; providerClassification?: Classification
}
export function resolveClassification(event: Pick<AnalysisEvent, 'classification' | 'userClassification' | 'providerClassification'>): Classification {
 return event.userClassification ?? event.providerClassification ?? event.classification ?? 'unknown'
}
/** Observations only. Historical late meetings never authorize future meetings. */
export function analyzeHistory(events: AnalysisEvent[], range: TimeRange) {
 if (!Number.isSafeInteger(range.fromMs) || !Number.isSafeInteger(range.toMs) || range.fromMs >= range.toMs) throw new RangeError('Invalid analysis range')
 const eligible = events.filter(e => e.startMs >= range.fromMs && e.startMs < range.toMs)
 const counts = {business:0, personal:0, unknown:0}, businessByWeekday = Array<number>(7).fill(0)
 const businessStartMinutes: number[] = [], lateBusinessEventIds: string[] = []
 let classified = 0
 for (const e of eligible) {
  const label = resolveClassification(e); counts[label]++
  if (e.userClassification !== undefined || e.providerClassification !== undefined || e.classification !== undefined) classified++
  if (label === 'business') {
   const parts = kstParts(e.startMs); businessByWeekday[parts.weekday]++; businessStartMinutes.push(parts.minuteOfDay)
   if (parts.minuteOfDay >= 18*60) lateBusinessEventIds.push(e.id)
  }
 }
 return {counts, coverage:{eligible:eligible.length, classified, partial:classified < eligible.length}, businessByWeekday, businessStartMinutes, lateBusinessEventIds}
}
