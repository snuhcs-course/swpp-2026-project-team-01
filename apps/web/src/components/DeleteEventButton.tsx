"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { call } from "./api"
import { TrashIcon } from "./ui"

export function DeleteEventButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    setBusy(true); setError(null)
    const res = await call("DELETE", `/api/events/${id}`)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? "삭제하지 못했어요"); return }
    setConfirming(false)
    router.refresh()
  }
  if (confirming) {
    return (
      <span className="inline-flex shrink-0 flex-col items-end gap-1" role="group" aria-label="일정 삭제 확인">
        <span className="inline-flex items-center gap-1 text-caption text-ink-soft">
          삭제할까요?
          <button type="button" disabled={busy} onClick={remove} className="min-h-8 rounded-md bg-danger px-2 font-medium text-white disabled:opacity-40">삭제</button>
          <button type="button" disabled={busy} onClick={() => { setConfirming(false); setError(null) }} className="min-h-8 rounded-md border border-border-strong px-2 text-ink-soft">취소</button>
        </span>
        {error && <span role="alert" className="text-caption font-medium text-danger">{error}</span>}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-label="일정 삭제"
      title="일정 삭제"
      onClick={() => setConfirming(true)}
      className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger"
    >
      <TrashIcon size={14} />
    </button>
  )
}
