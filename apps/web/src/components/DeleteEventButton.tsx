"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { call } from "./api"

export function DeleteEventButton({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      aria-label="일정 삭제"
      onClick={async () => {
        setBusy(true)
        await call("DELETE", `/api/events/${id}`)
        setBusy(false)
        router.refresh()
      }}
      className="text-xs text-slate-400 hover:text-rose-600 disabled:opacity-40"
    >
      삭제
    </button>
  )
}
