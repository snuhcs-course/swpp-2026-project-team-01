"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { weekdayKo } from "@/core/time"
import type { AvailabilityRule } from "@/core/types"
import { call } from "./api"

const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
const fromHm = (s: string) => {
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}
const ORDER = [1, 2, 3, 4, 5, 6, 0]

export function AvailabilityForm({ initial }: { initial: AvailabilityRule[] }) {
  const router = useRouter()
  const [rules, setRules] = useState(initial)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const patch = (weekday: number, p: Partial<AvailabilityRule>) => setRules((rs) => rs.map((r) => (r.weekday === weekday ? { ...r, ...p } : r)))

  async function save() {
    setBusy(true)
    setStatus(null)
    const res = await call("PUT", "/api/availability", { rules })
    setBusy(false)
    setStatus(res.ok ? { ok: true, text: "저장했어요" } : { ok: false, text: res.error ?? "저장하지 못했어요" })
    if (res.ok) router.refresh()
  }

  return (
    <div className="max-w-lg space-y-2">
      {ORDER.map((weekday) => {
        const r = rules.find((x) => x.weekday === weekday)!
        return (
          <div key={weekday} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
            <label className="flex w-24 items-center gap-2">
              <input type="checkbox" checked={r.enabled} onChange={(e) => patch(weekday, { enabled: e.target.checked })} />
              {weekdayKo(weekday)}요일
            </label>
            <input aria-label={`${weekdayKo(weekday)}요일 시작`} type="time" disabled={!r.enabled} value={toHm(r.startMin)} onChange={(e) => patch(weekday, { startMin: fromHm(e.target.value) })} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" />
            <span>~</span>
            <input aria-label={`${weekdayKo(weekday)}요일 끝`} type="time" disabled={!r.enabled} value={toHm(r.endMin)} onChange={(e) => patch(weekday, { endMin: fromHm(e.target.value) })} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40" />
          </div>
        )
      })}
      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={save} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-40">
          저장
        </button>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={`text-sm ${status.ok ? "text-emerald-700" : "text-rose-700"}`}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  )
}
