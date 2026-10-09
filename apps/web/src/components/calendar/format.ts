// AI-generated with Claude Code (claude-sonnet-5-5), 2026-10-05
import { DAY_MS, kstDateString, kstParts, kstTimeString, weekdayKo } from '@/core/time'
import type { ImportedEventView } from '@/contracts/calendar'

export const CLASS_LABEL: Record<string, string> = { unknown: '확인 필요', business: '업무', personal: '개인' }
export const LOCATION_LABEL: Record<string, string> = { none: '알 수 없음', office: '회사', place: '직접 지정', online: '온라인' }

const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10) }
function dateLabel(ms: number, thisYear: number) { const p = kstParts(ms); return `${p.year !== thisYear ? `${p.year}년 ` : ''}${p.month}월 ${p.day}일 (${weekdayKo(p.weekday)})` }
function isoLabel(iso: string, thisYear: number) { const [y, m, d] = iso.split('-').map(Number); return `${y !== thisYear ? `${y}년 ` : ''}${m}월 ${d}일 (${weekdayKo(new Date(Date.UTC(y, m - 1, d)).getUTCDay())})` }

export type RangeInput = Pick<ImportedEventView, 'startAt' | 'endAt' | 'allDay' | 'startDate' | 'endDate'>
/** All-day events use the calendar's own dates (end date is exclusive, as in Google Calendar), so they are right in any time zone. */
export function formatEventRange(e: RangeInput, thisYear = kstParts(Date.now()).year) {
  if (e.allDay && e.startDate && e.endDate) {
    const last = addDays(e.endDate, -1)
    return { allDay: true, text: last <= e.startDate ? `${isoLabel(e.startDate, thisYear)} · 종일` : `${isoLabel(e.startDate, thisYear)} – ${isoLabel(last, thisYear)} · 종일` }
  }
  if (kstDateString(e.startAt) === kstDateString(e.endAt)) return { allDay: false, text: `${dateLabel(e.startAt, thisYear)} ${kstTimeString(e.startAt)}–${kstTimeString(e.endAt)}` }
  return { allDay: false, text: `${dateLabel(e.startAt, thisYear)} ${kstTimeString(e.startAt)} – ${dateLabel(e.endAt, thisYear)} ${kstTimeString(e.endAt)}` }
}

export const aiHint = (e: Pick<ImportedEventView, 'aiClassification'>) =>
  e.aiClassification === null ? 'AI는 최근 8주 일정만 분류해요.'
    : e.aiClassification === 'unknown' ? 'AI도 판단하지 못했어요.'
      : `AI 제안: ${CLASS_LABEL[e.aiClassification]} (확인 전까지는 참고용이에요)`

/** Where an imported calendar came from. Demo accounts read an example calendar, never Google, and the screen must say so. */
export const PROVIDER_LABEL = { google: 'Google Calendar', mock: '예시 Calendar' } as const
export type ProviderKey = keyof typeof PROVIDER_LABEL
