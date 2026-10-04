'use client'
import { useState } from 'react'
import { Button, Input, PlusIcon, ToggleChip, TrashIcon } from '@/components/ui'
import { days, equal, type WindowInput } from './draftReducer'

// Monday-first; values keep the existing 0=Sun..6=Sat encoding.
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAYS = [1, 2, 3, 4, 5]

/** Assigns windows that share the same start/end text to one group, in first-seen order. */
function deriveGroups(windows: WindowInput[]) {
  const ids = new Map<string, number>()
  return windows.map(w => { const key = `${w.start}|${w.end}`; if (!ids.has(key)) ids.set(key, ids.size); return ids.get(key)! })
}

/**
 * Edits weekly windows as "time range + weekday chips" rows. The value is still the flat
 * WindowInput[] list (one entry per weekday), so saving and validation are unchanged.
 * Rows keep their identity while the user types (group ids are remembered for the list
 * this editor last emitted) and are re-derived when the list changes from outside.
 */
export function WeeklyWindowsEditor({ label, windows, onChange }: { label: string; windows: WindowInput[]; onChange: (value: WindowInput[]) => void }) {
  const [last, setLast] = useState<{ windows: WindowInput[]; groupOf: number[] } | null>(null)
  const groupOf = last && equal(last.windows, windows) ? last.groupOf : deriveGroups(windows)
  const order: number[] = []
  groupOf.forEach(g => { if (!order.includes(g)) order.push(g) })

  const emit = (next: WindowInput[], nextGroupOf: number[]) => { setLast({ windows: next, groupOf: nextGroupOf }); onChange(next) }
  const members = (g: number) => windows.flatMap((w, i) => groupOf[i] === g ? [i] : [])
  const setTime = (g: number, key: 'start' | 'end', value: string) =>
    emit(windows.map((w, i) => groupOf[i] === g ? { ...w, [key]: value } : w), groupOf)
  const toggleDay = (g: number, weekday: number) => {
    const idx = members(g)
    const has = idx.filter(i => windows[i].weekday === weekday)
    if (has.length) {
      if (has.length === idx.length) return // keep at least one weekday; use 삭제 to remove the row
      emit(windows.filter((_, i) => !has.includes(i)), groupOf.filter((_, i) => !has.includes(i)))
    } else {
      const sample = windows[idx[0]]
      emit([...windows, { weekday, start: sample.start, end: sample.end }], [...groupOf, g])
    }
  }
  const applyWeekdays = (g: number) => {
    const idx = members(g), sample = windows[idx[0]]
    const missing = WEEKDAYS.filter(d => !idx.some(i => windows[i].weekday === d))
    if (missing.length) emit([...windows, ...missing.map(weekday => ({ weekday, start: sample.start, end: sample.end }))], [...groupOf, ...missing.map(() => g)])
  }
  const remove = (g: number) => emit(windows.filter((_, i) => groupOf[i] !== g), groupOf.filter(x => x !== g))
  const add = () => emit([...windows, { weekday: 1, start: '09:00', end: '18:00' }], [...groupOf, Math.max(-1, ...groupOf) + 1])

  return <fieldset className="space-y-3">
    <legend className="mb-1 font-semibold text-ink">{label}</legend>
    {order.length === 0 && <p className="rounded-control border border-dashed border-border-strong px-3 py-3 text-small text-muted">설정한 구간이 없어요.</p>}
    {order.map((g, index) => {
      const n = index + 1
      const idx = members(g)
      const sample = windows[idx[0]]
      const active = new Set(idx.map(i => windows[i].weekday))
      const allWeekdays = WEEKDAYS.every(d => active.has(d))
      return <div key={g} className="space-y-3 rounded-control border border-border bg-surface-sunken/60 p-3">
        <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
          {(['start', 'end'] as const).map((key, k) => <div key={key} className="flex items-end gap-2">
            {k === 1 && <span aria-hidden="true" className="pb-2.5 text-muted">–</span>}
            <label className="block">
              <span className="mb-1 block text-caption font-medium text-muted">{key === 'start' ? '시작' : '종료'}</span>
              <Input className="w-24 text-center" aria-label={`${label} ${n} ${key === 'start' ? '시작' : '종료'} 시각`} placeholder="09:00" inputMode="numeric" value={sample[key]} onChange={e => setTime(g, key, e.target.value)} />
            </label>
          </div>)}
          <button type="button" className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-control px-2.5 text-small text-muted hover:bg-danger-soft hover:text-danger" aria-label={`${label} ${n} 구간 삭제`} onClick={() => remove(g)}><TrashIcon /><span aria-hidden="true">삭제</span></button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${label} ${n} 요일`}>
          {ORDER.map(d => <ToggleChip key={d} pressed={active.has(d)} aria-label={`${days[d]}요일`} title={active.has(d) && active.size === 1 ? '요일을 하나 이상 선택해야 해요' : undefined} onClick={() => toggleDay(g, d)}>{days[d]}</ToggleChip>)}
          <Button size="sm" variant="ghost" disabled={allWeekdays} onClick={() => applyWeekdays(g)} className="ml-1">평일에 적용</Button>
        </div>
      </div>
    })}
    <Button size="sm" onClick={add}><PlusIcon />{label} 구간 추가</Button>
    <p className="text-caption text-muted">요일을 여러 개 고르면 같은 시간이 모두에 적용돼요. 점심시간은 구간을 나누어 제외할 수 있어요. 하루의 끝은 24:00으로 입력하세요.</p>
  </fieldset>
}
