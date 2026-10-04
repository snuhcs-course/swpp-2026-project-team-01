/** Synthetic venture-capital investor calendar with ground-truth labels. Deterministic for a given seed. */
export type Truth = 'business' | 'personal' | 'ambiguous'
export interface ScenarioEvent { id: string; summary: string; startMs: number; endMs: number; truth: Truth; inWorkHours: boolean }

const KST = 9 * 3600_000, DAY = 86_400_000
const mulberry32 = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const WORK = ['포트폴리오 Weekly', '딜 소싱 미팅 - AI 스타트업', 'IC(투자심의위원회)', 'Series A 실사 콜', 'LP 미팅', '포트폴리오사 이사회', '창업자 1:1', '시장 리서치', '투자계약서 리뷰', '데모데이 심사']
const LATE_WORK = ['해외 LP 콜 (샌프란시스코)', 'IC 사전 리뷰', '실리콘밸리 파트너 콜']
const PERSONAL = ['헬스장 PT', '친구 저녁 약속', '러닝크루', '영어 회화 수업', '가족 저녁 식사', '필라테스']
const PERSONAL_DAYTIME = ['치과 검진', '은행 업무', '운전면허 갱신']
const WEEKEND = ['가족 점심', '등산', '결혼식 참석', '친구 브런치', '영화 관람']
const AMBIGUOUS = ['저녁 식사 - 김대표', '골프 (포트폴리오 대표)', '커피챗 - 지인 소개', 'OB 네트워킹 모임', '점심 - 창업자 면담', '지인 생일 파티 겸 업계 모임']

/** Day 0 is Monday 2026-10-05 KST. Covers the 56 days before it and the 60 days after. */
export function vcCalendar(seed = 7, from = -56, to = 60): ScenarioEvent[] {
  const rand = mulberry32(seed), pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]
  const base = Date.UTC(2026, 9, 5) - KST, out: ScenarioEvent[] = []
  let personalSeen = 0
  const add = (day: number, minute: number, length: number, summary: string, truth: Truth, inWorkHours: boolean) => out.push({ id: `ev-${String(out.length).padStart(4, '0')}`, summary, startMs: base + day * DAY + minute * 60_000, endMs: base + day * DAY + (minute + length) * 60_000, truth, inWorkHours })
  for (let day = from; day <= to; day++) {
    const weekday = ((day % 7) + 7) % 7 // 0 = Monday
    if (weekday < 5) {
      const taken: number[] = []
      for (let i = 0, n = 2 + Math.floor(rand() * 3); i < n; i++) {
        const length = rand() < 0.5 ? 30 : 60, start = 600 + 30 * Math.floor(rand() * ((480 - length) / 30 + 1))
        if (start < 780 && start + length > 720) continue // keep the lunch hour free for the lunch meeting below
        if (taken.some(t => Math.abs(t - start) < 90)) continue
        taken.push(start); add(day, start, length, pick(WORK), 'business', true)
      }
      if (rand() < 0.1) add(day, 1080 + 30 * Math.floor(rand() * 4), 60, pick(LATE_WORK), 'business', false)
      if (rand() < 0.4) {
        const daytime = personalSeen++ % 12 === 5 // about 4% of personal events (5% of weekday ones at most) fall inside work hours
        if (daytime) add(day, 840, 60, pick(PERSONAL_DAYTIME), 'personal', true)
        else add(day, 1110 + 30 * Math.floor(rand() * 4), 90, pick(PERSONAL), 'personal', false)
      }
      if (rand() < 0.25) add(day, rand() < 0.5 ? 720 : 1140, 60, pick(AMBIGUOUS), 'ambiguous', false)
    } else if (rand() < 0.6) add(day, 600 + 60 * Math.floor(rand() * 8), 120, pick(WEEKEND), 'personal', false)
  }
  return out
}

/** Google Calendar API event shape used by the provider adapter. */
export const googleEvent = (e: ScenarioEvent) => ({
  id: e.id, summary: e.summary, status: 'confirmed',
  start: { dateTime: new Date(e.startMs + KST).toISOString().slice(0, 19) + '+09:00' },
  end: { dateTime: new Date(e.endMs + KST).toISOString().slice(0, 19) + '+09:00' },
})
