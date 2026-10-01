"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { call } from "./api"

export function EventForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(defaultDate)
  const [start, setStart] = useState("10:00")
  const [end, setEnd] = useState("11:00")
  const [kind, setKind] = useState<"office" | "place" | "online" | "none">("none")
  const [placeRef, setPlaceRef] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await call("POST", "/api/events", { title, date, start, end, kind, placeRef: kind === "place" ? placeRef : null })
    setBusy(false)
    if (!res.ok) return setError(res.error)
    setTitle("")
    router.refresh()
  }

  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm"
  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-medium">일정 추가</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-slate-500">제목</span>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="block text-slate-500">날짜</span>
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="block text-slate-500">시작</span>
          <input required type="time" value={start} onChange={(e) => setStart(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="block text-slate-500">끝</span>
          <input required type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={input} />
        </label>
        <label className="text-sm">
          <span className="block text-slate-500">장소</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={input}>
            <option value="none">장소 없음</option>
            <option value="office">회사</option>
            <option value="place">다른 장소</option>
            <option value="online">온라인</option>
          </select>
        </label>
        {kind === "place" && (
          <label className="text-sm">
            <span className="block text-slate-500">장소 이름</span>
            <input value={placeRef} onChange={(e) => setPlaceRef(e.target.value)} placeholder="예: 강남 스터디카페" className={input} />
          </label>
        )}
        <button disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">
          추가
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {error}
        </p>
      )}
    </form>
  )
}
