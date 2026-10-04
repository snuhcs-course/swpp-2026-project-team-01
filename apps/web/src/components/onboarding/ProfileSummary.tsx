import type { ProfileDraftView } from '@/contracts/profile'
import { days, timeText } from './draftReducer'
import { WeekSchedule } from './WeekSchedule'
export function ProfileSummary({ draft }: { draft: ProfileDraftView }) {
  const p = draft.values.preferences
  const strength = (s: string) => s === 'strong' ? '중요' : '가능하면'
  const rows: [string, string][] = [
    ['근무', draft.values.work.mode === 'none' ? '고정 근무시간 없음' : '아래 구간 참고'],
    ['선호 요일', p.weekdays ? `${p.weekdays.value.map(d => days[d]).join(', ')} (${strength(p.weekdays.strength)})` : '없음'],
    ['선호 시작 시간', p.startTime ? `${timeText(p.startTime.value.startMin)}–${timeText(p.startTime.value.endMin)} (${strength(p.startTime.strength)})` : '없음'],
    ['미팅 방식', p.meetingMode ? `${p.meetingMode.value === 'online' ? '온라인' : '오프라인'} (${strength(p.meetingMode.strength)})` : '선호 없음'],
    ['미팅 사이 여유', p.slack ? strength(p.slack.strength) : '선호 없음'],
  ]
  return <div className="space-y-4">
    <dl className="grid gap-x-6 gap-y-2 rounded-control border border-border p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-small text-muted">{k}</dt><dd className="font-medium text-ink tabular">{v}</dd></div>)}
    </dl>
    <WeekSchedule values={draft.values} />
    <p className="text-caption text-muted">저장된 초안 revision <span className="tabular">{draft.revision}</span>. 최종 적용 전까지 확정 프로필은 바뀌지 않아요.</p>
  </div>
}
