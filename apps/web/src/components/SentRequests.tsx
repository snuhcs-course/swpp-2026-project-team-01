"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import type { RequestView } from "@/server/services/booking"
import { call } from "./api"
import { StatusBadge } from "./StatusBadge"

export function SentRequests({ requests }: { requests: RequestView[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function withdraw(id: string) {
    const res = await call("POST", `/api/requests/${id}/withdraw`)
    setError(res.error)
    if (res.ok) router.refresh()
  }

  if (requests.length === 0) return <p className="text-sm text-slate-400">보낸 요청이 없어요.</p>
  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <ul className="space-y-3">
        {requests.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.hostName}</span>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-sm">{r.label}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{r.message}</p>
            {r.status === "pending" && (
              <button type="button" onClick={() => withdraw(r.id)} className="mt-2 rounded-md border border-slate-300 px-3 py-1 text-sm">
                철회
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
