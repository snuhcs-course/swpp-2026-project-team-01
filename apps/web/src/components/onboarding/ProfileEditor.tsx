'use client'
import { AlertIcon, Checkbox } from '@/components/ui'
import { type DraftForm, parseForm } from './draftReducer'
import { WeeklyWindowsEditor } from './WeeklyWindowsEditor'
import { PreferenceEditor } from './PreferenceEditor'
const TOPICS = ['work', 'meetingWindows', 'preferences'] as const
const TOPIC_LABELS = ['근무시간을 확인했어요', '미팅 허용시간을 확인했어요', '기본 선호를 확인했어요 (선호 없음 포함)']
export function ProfileEditor({ form, onChange }: { form: DraftForm; onChange: (form: DraftForm) => void }) {
  const valid = parseForm(form).success
  const confirmed = TOPICS.filter(key => form.topics[key] === 'confirmed').length
  return <div className="space-y-6">
    <p className="text-small text-muted">모든 시간은 한국 시간(KST)이에요. 근무시간과 미팅 허용시간은 별도로 설정해요.</p>
    <div className="space-y-3">
      <Checkbox checked={form.work.mode === 'none'} onChange={e => onChange({ ...form, work: e.target.checked ? { mode: 'none', windows: [] } : { mode: 'fixed', windows: [{ weekday: 1, start: '09:00', end: '18:00' }] } })} label="고정 근무시간 없음" />
      {form.work.mode === 'fixed' && form.work.windows.length > 0 && <p className="text-caption text-muted">‘고정 근무시간 없음’을 켜면 입력한 근무 구간이 지워져요.</p>}
      {form.work.mode === 'fixed' && <WeeklyWindowsEditor label="근무" windows={form.work.windows} onChange={windows => onChange({ ...form, work: { mode: 'fixed', windows } })} />}
    </div>
    <div className="border-t border-border pt-6"><WeeklyWindowsEditor label="미팅 허용" windows={form.meetingWindows} onChange={meetingWindows => onChange({ ...form, meetingWindows })} /></div>
    <div className="border-t border-border pt-6"><PreferenceEditor value={form.preferences} onChange={preferences => onChange({ ...form, preferences })} /></div>
    {!valid && <p id="profile-validation" className="flex gap-2 rounded-control border border-danger/25 bg-danger-soft px-3 py-2.5 text-small font-medium text-danger-ink"><AlertIcon className="mt-0.5 shrink-0" />시간은 HH:MM 형식이고 종료는 시작보다 늦어야 해요. 고정 근무 구간과 선호 요일도 확인해 주세요.</p>}
    <fieldset className="rounded-control border border-primary/25 bg-primary-soft/50 p-4">
      <legend className="sr-only">주제별 확인</legend>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span aria-hidden="true" className="font-semibold text-ink">주제별 확인</span>
        <span className="text-small font-medium text-primary-soft-ink tabular">{confirmed}/3 확인</span>
      </div>
      <p className="mb-1 text-caption text-muted">세 주제를 모두 확인해야 최종 확정할 수 있어요.</p>
      {TOPICS.map((key, i) => <Checkbox key={key} checked={form.topics[key] === 'confirmed'} onChange={e => onChange({ ...form, topics: { ...form.topics, [key]: e.target.checked ? 'confirmed' : 'unanswered' } })} label={TOPIC_LABELS[i]} />)}
    </fieldset>
  </div>
}
