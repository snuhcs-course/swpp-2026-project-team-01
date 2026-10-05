import type { analyzeHistory } from './analysis'
import { MIN_EVENTS_FOR_ESTIMATE } from './analysis'
import { weekdayKo } from './time'

type Summary = ReturnType<typeof analyzeHistory>
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const PLACE = { office: '회사', place: '외부 장소', online: '온라인' } as const
const PLACE_OBJECT = { office: '회사를', place: '외부 장소를', online: '온라인을' } as const
function days(weekdays: number[]) {
  const set = weekdays.join()
  if (set === '1,2,3,4,5') return '평일'
  if (set === '1,2,3,4,5,6,0') return '매일'
  return weekdays.map(weekdayKo).join('·') + '요일'
}

/** The first analysis message: what was observed, and what it suggests — always worded as an estimate for the user to confirm. */
export function describeHistory(summary: Summary): string {
  const { counts, coverage, estimate } = summary
  const parts = [`지난 8주 일정 ${coverage.eligible}건 중 업무 ${counts.business}건, 개인 ${counts.personal}건, 확인 필요 ${counts.unknown}건을 관찰했어요.`]
  if (coverage.partial) parts.push(`AI가 분류하지 못한 일정 ${coverage.eligible - coverage.classified}건은 확인 필요에 포함돼 있어요.`)
  const busiest = summary.businessByWeekday.map((count, day) => ({ count, day })).filter(d => d.count).sort((a, b) => b.count - a.count).slice(0, 3)
  if (busiest.length) parts.push(`업무 일정은 ${busiest.map(d => `${weekdayKo(d.day)}요일 ${d.count}건`).join(', ')}에 있었어요. 이 요일을 선호하시나요?`)
  if (estimate.basedOn < MIN_EVENTS_FOR_ESTIMATE) {
    parts.push(counts.business ? `업무 일정이 ${counts.business}건뿐이라 근무시간이나 미팅 시간을 추정하기는 어려워요. 직접 알려 주세요.` : '일정만으로 근무시간과 선호를 알기 어려워요. 직접 알려 주세요.')
  } else {
    const guesses: string[] = []
    if (estimate.workHours) guesses.push(`예상 근무시간은 ${days(estimate.workHours.weekdays)} ${hm(estimate.workHours.startMin)}–${hm(estimate.workHours.endMin)}`)
    if (estimate.meetingStarts) guesses.push(`기존 미팅은 주로 ${hm(estimate.meetingStarts.fromMin)}–${hm(estimate.meetingStarts.toMin)} 사이에 시작했어요`)
    if (guesses.length) parts.push(`지난 업무 일정 ${estimate.basedOn}건으로 짐작해 보면, ${guesses.join('이고, ')}.`)
  }
  if (estimate.places.length) {
    const [top] = estimate.places
    parts.push(`업무 일정 장소는 ${estimate.places.map(p => `${PLACE[p.kind]} ${p.count}건`).join(', ')}이라 ${PLACE_OBJECT[top.kind]} 선호하시는 것 같아요.`)
  }
  if (summary.lateBusinessEventIds.length) parts.push(`저녁 업무 일정도 ${summary.lateBusinessEventIds.length}건 있었지만, 앞으로 그 시간에 미팅을 허용한다는 뜻은 아니에요.`)
  parts.push('모두 지난 일정에서 본 경향이라, 맞으면 직접 설정에 반영하거나 말로 고쳐 주세요.')
  return parts.join(' ')
}
