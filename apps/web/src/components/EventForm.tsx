"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { call } from "./api"
import { Alert, Button, Card, Field, Input, PlusIcon, SectionHeader, Select, Spinner } from "./ui"

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

  return (
    <Card>
      <form onSubmit={submit}>
        <SectionHeader title="일정 추가" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.2fr)]">
          <Field label="제목" className="sm:col-span-2 lg:col-span-1">
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="날짜">
            <Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="시작">
            <Input required type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="끝">
            <Input required type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="장소">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="none">장소 없음</option>
              <option value="office">회사</option>
              <option value="place">다른 장소</option>
              <option value="online">온라인</option>
            </Select>
          </Field>
          {kind === "place" && (
            <Field label="장소 이름" className="sm:col-span-2 lg:col-span-2">
              <Input value={placeRef} onChange={(e) => setPlaceRef(e.target.value)} placeholder="예: 강남 스터디카페" />
            </Field>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? <Spinner /> : <PlusIcon />}
            추가
          </Button>
        </div>
        {error && (
          <Alert tone="danger" role="alert" className="mt-4">
            {error}
          </Alert>
        )}
      </form>
    </Card>
  )
}
