'use client'
import { Input, Select, ToggleChip } from '@/components/ui'
import { days, timeText, type Values } from './draftReducer'
type Preferences = Values['preferences']
const ORDER = [1, 2, 3, 4, 5, 6, 0]
export function PreferenceEditor({ value, onChange }: { value: Preferences; onChange: (value: Preferences) => void }) {
  const labels = { weekdays: '선호 요일', startTime: '선호 시작 시간', meetingMode: '미팅 방식', slack: '미팅 사이 여유' }
  return <fieldset className="space-y-3"><legend className="mb-1 font-semibold text-ink">기본 선호</legend>
    <div className="divide-y divide-border rounded-control border border-border">
    {(Object.keys(labels) as (keyof Preferences)[]).map(key => <div key={key} className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink-soft">{labels[key]}</span>
        <Select wrapperClassName="w-36" aria-label={`${labels[key]} 강도`} value={value[key]?.strength ?? 'none'} onChange={e => {
          const strength = e.target.value as 'strong' | 'weak'
          const defaults = { weekdays: { value: [1, 2, 3, 4, 5], strength }, startTime: { value: { startMin: 540, endMin: 1080 }, strength }, meetingMode: { value: 'online' as const, strength }, slack: { strength } }
          onChange({ ...value, [key]: e.target.value === 'none' ? null : { ...(value[key] ?? defaults[key]), strength } })
        }}><option value="none">선호 없음</option><option value="weak">가능하면</option><option value="strong">중요해요</option></Select>
      </div>
      {key === 'weekdays' && value.weekdays && <div role="group" aria-label="선호 요일 선택" className="flex flex-wrap gap-1.5">{ORDER.map(i => { const day = days[i], checked = value.weekdays!.value.includes(i); return <ToggleChip key={day} pressed={checked} aria-label={`${day}요일`} onClick={() => onChange({ ...value, weekdays: { ...value.weekdays!, value: !checked ? [...value.weekdays!.value, i].sort() : value.weekdays!.value.filter(d => d !== i) } })}>{day}</ToggleChip> })}</div>}
      {key === 'meetingMode' && value.meetingMode && <Select wrapperClassName="w-40" aria-label="선호 미팅 방식" value={value.meetingMode.value} onChange={e => onChange({ ...value, meetingMode: { ...value.meetingMode!, value: e.target.value as 'online' | 'offline' } })}><option value="online">온라인</option><option value="offline">오프라인</option></Select>}
      {key === 'startTime' && value.startTime && <div className="flex flex-wrap items-end gap-2">{(['startMin', 'endMin'] as const).map((field, k) => <div key={field} className="flex items-end gap-2">
        {k === 1 && <span aria-hidden="true" className="pb-2.5 text-muted">–</span>}
        <label className="block"><span className="mb-1 block text-caption font-medium text-muted">{field === 'startMin' ? '시작' : '끝'}</span><Input type="time" className="w-36" aria-label={`선호 시간 ${field === 'startMin' ? '시작' : '끝'}`} value={Number.isFinite(value.startTime!.value[field]) ? timeText(value.startTime!.value[field]) : ''} onChange={e => {
          const [h, m] = e.target.value.split(':').map(Number)
          onChange({ ...value, startTime: { ...value.startTime!, value: { ...value.startTime!.value, [field]: h * 60 + m } } })
        }} /></label></div>)}</div>}
    </div>)}
    </div>
  </fieldset>
}
