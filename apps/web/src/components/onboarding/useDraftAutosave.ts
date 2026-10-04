'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { profileDraftViewSchema, type ProfileDraftView } from '@/contracts/profile'
import type { ApiResult } from '@/contracts/common'
import { request } from '@/components/api'
import { useMutationOperation } from '@/components/hooks/useMutationOperation'
import { draftReducer, equal, parseForm, toForm, type DraftAction, type DraftEditorState, type DraftForm } from './draftReducer'

export function useDraftAutosave(initial: ProfileDraftView) {
  const [state, setState] = useState<DraftEditorState>({ saved: initial, form: toForm(initial), conflict: false })
  const current = useRef(state)
  const [error, setError] = useState<string | null>(null)
  const operation = useMutationOperation<ProfileDraftView>()
  const sent = useRef<DraftForm | null>(null)
  const flight = useRef<Promise<boolean> | null>(null)
  const dispatch = useCallback((action: DraftAction) => { current.current = draftReducer(current.current, action); setState(current.current) }, [])
  const refreshConflict = useCallback(async () => {
    const result = await request('GET', `/api/profile-drafts/${encodeURIComponent(current.current.saved.draftId)}`, profileDraftViewSchema)
    if (result.ok) dispatch({ type: 'conflict', draft: result.data })
    setError(result.ok ? '최신 저장 내용과 내 입력을 비교해 주세요. 이전 AI 답변은 자동 적용하지 않아요.' : '최신 내용을 불러오지 못했어요. 다시 확인해 주세요.')
  }, [dispatch])
  const accept = useCallback(async (result: ApiResult<ProfileDraftView> | null) => {
    if (!result) return false
    if (result.ok) { dispatch({ type: 'saved', draft: result.data, sent: sent.current ?? undefined }); sent.current = null; setError(null); return true }
    setError([result.error.message, ...Object.values(result.error.fieldErrors ?? {}).flat()].join(' '))
    if (result.error.code === 'revision_conflict') await refreshConflict()
    return false
  }, [dispatch, refreshConflict])
  const save = useCallback(async (): Promise<boolean> => {
    if (flight.current) return flight.current
    const s = current.current
    if (s.conflict || operation.pending) return false
    if (equal(s.form, toForm(s.saved))) return true
    const parsed = parseForm(s.form)
    if (!parsed.success) return false
    sent.current = structuredClone(s.form)
    const patch: Record<string, unknown> = {}
    for (const key of ['work', 'meetingWindows', 'preferences'] as const) if (!equal(s.form[key], toForm(s.saved)[key])) patch[key] = parsed.data[key]
    const task = operation.run({ method: 'PATCH', url: `/api/profile-drafts/${encodeURIComponent(s.saved.draftId)}`, kind: 'profile.draft.patch', payload: { expectedRevision: s.saved.revision, patch, topicConfirmations: s.form.topics }, schema: profileDraftViewSchema }).then(accept)
    flight.current = task
    const ok = await task; flight.current = null; return ok
  }, [operation.pending, operation.run, accept])
  const dirty = !equal(state.form, toForm(state.saved))
  const valid = parseForm(state.form).success
  useEffect(() => {
    if (!dirty || !valid || error || operation.pending || state.conflict) return
    const timer = setTimeout(() => { void save() }, 500)
    return () => clearTimeout(timer)
  }, [state.form, state.saved, state.conflict, dirty, valid, error, operation.pending, save])
  useEffect(() => {
    if (!dirty && !operation.pending) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, operation.pending])
  const flush = async () => {
    if (flight.current && !await flight.current) return false
    if (current.current.conflict || operation.pending) return false
    if (!await save()) return false
    return equal(current.current.form, toForm(current.current.saved))
  }
  return { state, current, dirty, valid, error, setError, dispatch, operation, flush, refreshConflict,
    edit: (form: DraftForm) => { if (!current.current.conflict && operation.phase === 'idle') setError(null); dispatch({ type: 'edit', form }) },
    retry: async () => { setError(null); if (operation.phase === 'reconciling') await accept(await operation.recover()); else await save() },
  }
}
