"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import type { RequestView } from "@/server/services/booking"
import { call } from "./api"
import { StatusBadge } from "./StatusBadge"

export function InboxGroup({ group }: { group: RequestView[] }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function act(id: string, action: "accept" | "decline") {
    setBusy(true)
    setError(null)
    const res = await call("POST", `/api/requests/${id}/${action}`)
    setBusy(false)
    setConfirming(null)
    if (!res.ok) return setError(res.error)
    router.refresh()
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      {group.length > 1 && <p className="mb-2 text-xs font-medium text-amber-800">같은 시간대에 {group.length}건이 겹쳐 있어요. 하나를 수락하면 나머지는 자동 거절돼요.</p>}
      {error && <p role="alert" className="mb-2 text-sm text-rose-700">{error}</p>}
      <ul className="divide-y divide-slate-100">
        {group.map((r) => (
          <li key={r.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.clientName}</span>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-sm">{r.label}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{r.message}</p>
            {confirming === r.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span>{group.length > 1 ? `겹치는 요청 ${group.length - 1}건은 자동 거절됩니다.` : "이 요청을 수락할까요?"}</span>
                <button type="button" disabled={busy} onClick={() => act(r.id, "accept")} className="rounded-md bg-emerald-600 px-3 py-1 text-white disabled:opacity-40">확인</button>
                <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="rounded-md border border-slate-300 px-3 py-1">취소</button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy} onClick={() => setConfirming(r.id)} className="rounded-md bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-40">수락</button>
                <button type="button" disabled={busy} onClick={() => act(r.id, "decline")} className="rounded-md border border-slate-300 px-3 py-1 text-sm disabled:opacity-40">거절</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
