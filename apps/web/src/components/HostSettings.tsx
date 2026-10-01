"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import type { MeetingType, Place, PlaceKind } from "@/core/types"
import { call } from "./api"

const KIND_LABEL: Record<PlaceKind, string> = { office_near: "회사 근처", special: "특정 장소", online: "온라인" }
const input = "rounded-md border border-slate-300 px-2 py-1 text-sm"

function Row({ children, onDelete, error }: { children: React.ReactNode; onDelete: () => void; error?: string | null }) {
  return (
    <li className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        <button type="button" onClick={onDelete} className="text-xs text-slate-400 hover:text-rose-600">
          삭제
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
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
    <Row error={error} onDelete={async () => { await call("DELETE", `/api/places/${place.id}`); router.refresh() }}>
      <select aria-label="장소 종류" value={kind} onChange={(e) => { const k = e.target.value as PlaceKind; setKind(k); void save({ kind: k, name }) }} className={input}>
        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input aria-label="장소 이름" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== place.name && void save({ kind, name })} className={input} />
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
    <Row error={error} onDelete={async () => { await call("DELETE", `/api/meeting-types/${type.id}`); router.refresh() }}>
      <input aria-label="양식 이름" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} className={input} />
      <input aria-label="길이(분)" type="number" min={5} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} onBlur={save} className={`${input} w-20`} />
      <span className="text-slate-500">분</span>
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
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h2 className="mb-2 font-medium">장소</h2>
        <ul className="space-y-2">
          {places.map((p) => <PlaceEditor key={`${p.id}-${p.kind}-${p.name}`} place={p} />)}
          {places.length === 0 && <li className="text-sm text-slate-400">등록된 장소가 없어요.</li>}
        </ul>
        <form onSubmit={addPlace} className="mt-3 flex flex-wrap gap-2">
          <select aria-label="새 장소 종류" value={placeKind} onChange={(e) => setPlaceKind(e.target.value as PlaceKind)} className={input}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input required aria-label="새 장소 이름" value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="장소 이름" className={input} />
          <button className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white">장소 추가</button>
        </form>
      </section>
      <section>
        <h2 className="mb-2 font-medium">미팅 양식</h2>
        <ul className="space-y-2">
          {types.map((t) => <TypeEditor key={`${t.id}-${t.name}-${t.durationMin}`} type={t} />)}
          {types.length === 0 && <li className="text-sm text-slate-400">등록된 양식이 없어요.</li>}
        </ul>
        <form onSubmit={addType} className="mt-3 flex flex-wrap gap-2">
          <input required aria-label="새 양식 이름" value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="예: 45분 리뷰" className={input} />
          <input required aria-label="새 양식 길이(분)" type="number" min={5} max={480} step={5} value={typeMin} onChange={(e) => setTypeMin(e.target.value)} className={`${input} w-20`} />
          <span className="self-center text-sm text-slate-500">분</span>
          <button className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white">양식 추가</button>
        </form>
      </section>
      {error && <p role="alert" className="text-sm text-rose-700 md:col-span-2">{error}</p>}
    </div>
  )
}
