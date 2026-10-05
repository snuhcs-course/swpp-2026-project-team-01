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

type Topic = 'work' | 'meeting' | 'place'
/** Is this a question about what the analysis saw (as opposed to the user telling us their hours)? */
export function historyQuestion(text: string): Topic[] | null {
  const t = text.trim()
  if (!/[?？]$|어떻게|뭐|몇 ?시|언제|어디|무슨|알려 ?줘|생각했|추정|짐작|봤어|분석/.test(t)) return null
  const topics: Topic[] = []
  if (/근무|일하|출근|퇴근|업무 ?시간/.test(t)) topics.push('work')
  if (/미팅|회의|약속/.test(t)) topics.push('meeting')
  if (/장소|어디서|온라인|오프라인|회사|대면/.test(t)) topics.push('place')
  return topics.length ? topics : ['work', 'meeting', 'place']
}

/** Answers from the stored analysis only; nothing here is invented, and an estimate is always called one. */
export function answerFromHistory(summary: Summary | null, topics: Topic[]): string {
  if (!summary) return '아직 가져온 일정을 분석하지 않았어요. ‘가져온 일정 분석하기’를 누르면 지난 8주 일정으로 짐작해 드릴게요.'
  const { estimate, counts } = summary
  if (!estimate) return '이 분석은 추정 기능이 생기기 전에 만들어졌어요. ‘다시 분석’을 누르면 근무시간과 장소를 짐작해 드릴게요.'
  const out: string[] = []
  const thin = estimate.basedOn < MIN_EVENTS_FOR_ESTIMATE
  if (topics.includes('work')) out.push(estimate.workHours
    ? `지난 업무 일정으로 보면 근무시간은 ${days(estimate.workHours.weekdays)} ${hm(estimate.workHours.startMin)}–${hm(estimate.workHours.endMin)}쯤으로 보여요.`
    : thin ? `업무로 분류된 일정이 ${counts.business}건뿐이라 근무시간은 짐작하기 어려워요.` : '업무 일정이 대부분 하루 한 건이라 근무시간 전체는 짐작하기 어려워요.')
  if (topics.includes('meeting')) out.push(estimate.meetingStarts
    ? `기존 미팅은 주로 ${hm(estimate.meetingStarts.fromMin)}–${hm(estimate.meetingStarts.toMin)} 사이에 시작했어요.`
    : `미팅 시간대를 짐작할 만큼 업무 일정이 많지 않아요(${counts.business}건).`)
  if (topics.includes('place')) out.push(estimate.places.length
    ? `업무 일정 장소는 ${estimate.places.map(p => `${PLACE[p.kind]} ${p.count}건`).join(', ')}이었어요.`
    : '장소가 확인된 업무 일정이 없어서 선호 장소는 알 수 없어요.')
  if (thin) out.push('가져온 일정 확인에서 업무 일정을 바로잡고 다시 분석하면 더 정확해져요.')
  out.push('지난 일정에서 본 경향일 뿐이니, 맞으면 말씀해 주시거나 직접 설정에 반영해 주세요.')
  return out.join(' ')
}
