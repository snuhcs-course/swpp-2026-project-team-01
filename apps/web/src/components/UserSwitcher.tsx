"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { call } from "./api"

export function UserSwitcher({ users, currentId }: { users: { id: string; name: string }[]; currentId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function change(userId: string) {
    setBusy(true)
    await call("POST", "/api/session", { userId })
    setBusy(false)
    router.push("/book")
    router.refresh()
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">현재 사용자</span>
      <select
        aria-label="현재 사용자"
        value={currentId}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  )
}
