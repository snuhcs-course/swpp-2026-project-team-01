import type { DraftTopics, ProfileDraftView } from '@/contracts/profile'
import { profileValuesSchema } from '@/contracts/profile'
export type Values = ProfileDraftView['values']
export type WindowInput = { weekday: number; start: string; end: string }
export type DraftForm = Omit<Values, 'work' | 'meetingWindows'> & { work: { mode: 'fixed' | 'none'; windows: WindowInput[] }; meetingWindows: WindowInput[]; topics: DraftTopics }
export const timeText = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const days = ['일', '월', '화', '수', '목', '금', '토']
export function toForm(draft: ProfileDraftView): DraftForm {
  const windows = (list: Values['meetingWindows']) => list.map(w => ({ weekday: w.weekday, start: timeText(w.startMin), end: timeText(w.endMin) }))
  return { ...draft.values, work: { ...draft.values.work, windows: windows(draft.values.work.windows) }, meetingWindows: windows(draft.values.meetingWindows), topics: draft.topics }
}
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function parseForm(form: DraftForm) {
  const minute = (s: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s) || s === '24:00' ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : NaN
  const windows = (list: WindowInput[]) => list.map(w => ({ weekday: w.weekday, startMin: minute(w.start), endMin: minute(w.end) }))
  return profileValuesSchema.safeParse({ work: { mode: form.work.mode, windows: windows(form.work.windows) }, meetingWindows: windows(form.meetingWindows), preferences: form.preferences })
}
export type DraftEditorState = { saved: ProfileDraftView; form: DraftForm; conflict: boolean }
export type DraftAction = { type: 'edit'; form: DraftForm } | { type: 'saved'; draft: ProfileDraftView; sent?: DraftForm } | { type: 'conflict'; draft: ProfileDraftView } | { type: 'resolve'; keepLocal: boolean }
export function draftReducer(state: DraftEditorState, action: DraftAction): DraftEditorState {
  if (action.type === 'edit') return { ...state, form: action.form }
  if (action.type === 'resolve') return { ...state, conflict: false, form: action.keepLocal ? state.form : toForm(state.saved) }
  if (action.draft.draftId !== state.saved.draftId || action.draft.revision < state.saved.revision) return state
  const sent = action.type === 'saved' ? action.sent : undefined
  const previous = sent ?? toForm(state.saved)
  const server = toForm(action.draft)
  const form = { ...server }
  for (const key of ['work', 'meetingWindows', 'preferences', 'topics'] as const) {
    if (!equal(state.form[key], previous[key])) Object.assign(form, { [key]: state.form[key] })
  }
  const overlap = !sent && (['work', 'meetingWindows', 'preferences', 'topics'] as const).some(key => !equal(state.form[key], previous[key]) && !equal(server[key], previous[key]))
  return { saved: action.draft, form, conflict: state.conflict || action.type === 'conflict' || overlap }
}
