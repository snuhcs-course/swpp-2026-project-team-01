"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { call } from "./api"
import { Select } from "./ui"

export function UserSwitcher({ users, currentId }: { users: { id: string; name: string }[]; currentId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(userId: string) {
    setBusy(true); setError(null)
    const res = await call("POST", "/api/session", { userId })
    setBusy(false)
    if (!res.ok) { setError(res.error ?? "사용자를 바꾸지 못했어요"); return }
    router.push("/book")
    router.refresh()
  }

  return (
    <label className="flex items-center gap-2 text-small">
      <span className="hidden text-muted sm:inline">현재 사용자</span>
      <Select
        aria-label="현재 사용자"
        value={currentId}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        controlSize="sm"
        wrapperClassName="w-36 sm:w-44"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      {error && <span role="alert" className="text-caption font-medium text-danger">{error}</span>}
    </label>
  )
}
