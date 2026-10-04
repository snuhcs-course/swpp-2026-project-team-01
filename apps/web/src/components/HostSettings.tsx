"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import type { MeetingType, Place, PlaceKind } from "@/core/types"
import { call } from "./api"
import { Alert, Button, Card, Input, PlusIcon, SectionHeader, Select, TrashIcon } from "./ui"

const KIND_LABEL: Record<PlaceKind, string> = { office_near: "회사 근처", special: "특정 장소", online: "온라인" }

function Row({ children, onDelete, deleteLabel, error }: { children: React.ReactNode; onDelete: () => void | Promise<void>; deleteLabel: string; error?: string | null }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <li className="rounded-control border border-border bg-surface-sunken/60 p-2.5">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
        {confirming ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-small text-ink-soft" role="group" aria-label={`${deleteLabel} 확인`}>
            삭제할까요?
            <button type="button" disabled={pending} onClick={async () => { setPending(true); try { await onDelete() } finally { setPending(false); setConfirming(false) } }} className="min-h-10 rounded-control bg-danger px-3 font-medium text-white disabled:opacity-40">삭제</button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="min-h-10 rounded-control border border-border-strong px-3">취소</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} aria-label={deleteLabel} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-control px-2.5 text-small text-muted hover:bg-danger-soft hover:text-danger">
            <TrashIcon />
            <span aria-hidden="true" className="hidden sm:inline">삭제</span>
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-1.5 text-caption font-medium text-danger">{error}</p>}
    </li>
  )
}

function PlaceEditor({ place }: { place: Place }) {
  const router = useRouter()
  const [kind, setKind] = useState(place.kind)
  const [name, setName] = useState(place.name)
  const [error, setError] = useState<string | null>(null)
  const save = async (next: { kind: PlaceKind; name: string }) => {
    const res = await call("PATCH", `/api/places/${place.id}`, next)
    setError(res.error)
    if (res.ok) router.refresh()
  }
  return (
    <Row error={error} deleteLabel={`${place.name} 장소 삭제`} onDelete={async () => { const res = await call("DELETE", `/api/places/${place.id}`); setError(res.error); if (res.ok) router.refresh() }}>
      <Select aria-label="장소 종류" value={kind} onChange={(e) => { const k = e.target.value as PlaceKind; setKind(k); void save({ kind: k, name }) }} wrapperClassName="w-32 shrink-0">
        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      <Input aria-label="장소 이름" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== place.name && void save({ kind, name })} className="min-w-0 flex-1 basis-40" />
    </Row>
  )
}

function TypeEditor({ type }: { type: MeetingType }) {
  const router = useRouter()
  const [name, setName] = useState(type.name)
  const [minutes, setMinutes] = useState(String(type.durationMin))
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    const res = await call("PATCH", `/api/meeting-types/${type.id}`, { name, durationMin: Number(minutes) })
    setError(res.error)
    if (res.ok) router.refresh()
  }
  return (
    <Row error={error} deleteLabel={`${type.name} 양식 삭제`} onDelete={async () => { const res = await call("DELETE", `/api/meeting-types/${type.id}`); setError(res.error); if (res.ok) router.refresh() }}>
      <Input aria-label="양식 이름" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} className="min-w-0 flex-1 basis-40" />
      <span className="flex items-center gap-1.5">
        <Input aria-label="길이(분)" type="number" min={5} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} onBlur={save} className="w-20" />
        <span className="text-small text-muted">분</span>
      </span>
    </Row>
  )
}

export function HostSettings({ places, types }: { places: Place[]; types: MeetingType[] }) {
  const router = useRouter()
  const [placeKind, setPlaceKind] = useState<PlaceKind>("office_near")
  const [placeName, setPlaceName] = useState("")
  const [typeName, setTypeName] = useState("")
  const [typeMin, setTypeMin] = useState("30")
  const [error, setError] = useState<string | null>(null)

  async function addPlace(e: React.FormEvent) {
    e.preventDefault()
    const res = await call("POST", "/api/places", { kind: placeKind, name: placeName })
    setError(res.error)
    if (res.ok) { setPlaceName(""); router.refresh() }
  }
  async function addType(e: React.FormEvent) {
    e.preventDefault()
    const res = await call("POST", "/api/meeting-types", { name: typeName, durationMin: Number(typeMin) })
    setError(res.error)
    if (res.ok) { setTypeName(""); router.refresh() }
  }

  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <Card>
        <SectionHeader title="장소" description="만날 수 있는 장소예요. 이름을 고치면 자리를 벗어날 때 저장돼요." />
        <ul className="space-y-2">
          {places.map((p) => <PlaceEditor key={`${p.id}-${p.kind}-${p.name}`} place={p} />)}
          {places.length === 0 && <li className="rounded-control border border-dashed border-border-strong px-3 py-4 text-center text-small text-muted">등록된 장소가 없어요.</li>}
        </ul>
        <form onSubmit={addPlace} className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Select aria-label="새 장소 종류" value={placeKind} onChange={(e) => setPlaceKind(e.target.value as PlaceKind)} wrapperClassName="w-32 shrink-0">
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Input required aria-label="새 장소 이름" value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="장소 이름" className="min-w-0 flex-1 basis-40" />
          <Button type="submit" variant="primary"><PlusIcon />장소 추가</Button>
        </form>
      </Card>
      <Card>
        <SectionHeader title="미팅 양식" description="요청자가 고를 수 있는 미팅 이름과 길이예요." />
        <ul className="space-y-2">
          {types.map((t) => <TypeEditor key={`${t.id}-${t.name}-${t.durationMin}`} type={t} />)}
          {types.length === 0 && <li className="rounded-control border border-dashed border-border-strong px-3 py-4 text-center text-small text-muted">등록된 양식이 없어요.</li>}
        </ul>
        <form onSubmit={addType} className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Input required aria-label="새 양식 이름" value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="예: 45분 리뷰" className="min-w-0 flex-1 basis-40" />
          <span className="flex items-center gap-1.5">
            <Input required aria-label="새 양식 길이(분)" type="number" min={5} max={480} step={5} value={typeMin} onChange={(e) => setTypeMin(e.target.value)} className="w-20" />
            <span className="text-small text-muted">분</span>
          </span>
          <Button type="submit" variant="primary"><PlusIcon />양식 추가</Button>
        </form>
      </Card>
      {error && <Alert tone="danger" role="alert" className="md:col-span-2">{error}</Alert>}
    </div>
  )
}
