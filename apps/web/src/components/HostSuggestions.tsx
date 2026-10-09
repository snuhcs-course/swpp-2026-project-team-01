// AI-generated with Claude Code (claude-opus-5-5), 2026-10-06
"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { z } from "zod"
import type { HostSuggestions as Suggestions } from "@/core/host-suggestions"
import type { PlaceKind } from "@/core/types"
import { call, request } from "./api"
import { Alert, Badge, Button, buttonClass, Card, Input, PlusIcon, SectionHeader, Select, Spinner, Textarea } from "./ui"

const KIND_LABEL: Record<PlaceKind, string> = { office_near: "회사 근처", special: "특정 장소", online: "온라인" }
const proposalSchema = z.object({
  places: z.array(z.object({ kind: z.enum(["office_near", "special", "online"]), name: z.string() })),
  meetingTypes: z.array(z.object({ name: z.string(), durationMin: z.number() })),
  failed: z.boolean(),
  failure: z.enum(["unavailable", "unparseable"]).nullable(),
})
type PlaceItem = { key: string; kind: PlaceKind; name: string; note: string }
type TypeItem = { key: string; name: string; durationMin: number; note: string }

/** One proposal the host can adjust and add. Until it is added, nobody else sees it. */
function Row({ children, onAdd, label }: { children: React.ReactNode; onAdd: () => Promise<string | null>; label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <li className="rounded-control border border-dashed border-border-strong p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button size="sm" variant="primary" className="ml-auto" disabled={busy} aria-label={`${label} 추가`} onClick={async () => { setBusy(true); setError(await onAdd()); setBusy(false) }}>
          {busy ? <Spinner /> : <PlusIcon />}추가
        </Button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-caption font-medium text-danger">{error}</p>}
    </li>
  )
}

function PlaceRow({ item, onAdded }: { item: PlaceItem; onAdded: () => void }) {
  const [kind, setKind] = useState(item.kind), [name, setName] = useState(item.name)
  return (
    <Row label={`${name} 장소`} onAdd={async () => { const res = await call("POST", "/api/places", { kind, name }); if (res.ok) onAdded(); return res.error }}>
      <Select aria-label="제안 장소 종류" value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)} wrapperClassName="w-32 shrink-0">
        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      <Input aria-label="제안 장소 이름" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 basis-40" />
      <span className="text-caption text-muted">{item.note}</span>
    </Row>
  )
}

function TypeRow({ item, onAdded }: { item: TypeItem; onAdded: () => void }) {
  const [name, setName] = useState(item.name)
  return (
    <Row label={`${name} 양식`} onAdd={async () => { const res = await call("POST", "/api/meeting-types", { name, durationMin: item.durationMin }); if (res.ok) onAdded(); return res.error }}>
      <Input aria-label="제안 양식 이름" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 basis-40" />
      <Badge>{item.durationMin}분</Badge>
      <span className="text-caption text-muted">{item.note}</span>
    </Row>
  )
}

/**
 * Fills host setup from the calendar and from what the host says, instead of entering every place and length by hand.
 * Suggestions come from code (past business events); spoken ones from the AI's reading of the text. Both are only proposals.
 */
export function HostSuggestions({ suggestions }: { suggestions: Suggestions & { available: boolean } }) {
  const router = useRouter()
  const [added, setAdded] = useState<string[]>([])
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: "warn" | "neutral"; text: string } | null>(null)
  const [spoken, setSpoken] = useState<{ places: PlaceItem[]; types: TypeItem[] }>({ places: [], types: [] })
  const done = (key: string) => () => { setAdded((list) => [...list, key]); router.refresh() }

  const places: PlaceItem[] = [
    ...suggestions.places.map((p) => ({ key: `c-p-${p.kind}-${p.name}`, kind: p.kind, name: p.name, note: `지난 8주 ${p.count}건` })),
    ...spoken.places,
  ].filter((p) => !added.includes(p.key))
  const types: TypeItem[] = [
    ...suggestions.meetingTypes.map((t) => ({ key: `c-t-${t.durationMin}`, name: t.name, durationMin: t.durationMin, note: `지난 8주 ${t.count}건` })),
    ...spoken.types,
  ].filter((t) => !added.includes(t.key))

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setNotice(null)
    const r = await request("POST", "/api/host-setup/interpret", proposalSchema, { text })
    setBusy(false)
    if (!r.ok) { setNotice({ tone: "warn", text: r.error.message }); return }
    if (r.data.failed) {
      setNotice({ tone: "warn", text: r.data.failure === "unavailable" ? "AI 응답을 받지 못했어요. 잠시 후 다시 시도하거나 아래에서 직접 추가해 주세요." : "말씀을 장소·미팅 양식으로 해석하지 못했어요. 더 구체적으로 알려 주시거나 아래에서 직접 추가해 주세요." })
      return
    }
    const stamp = Date.now()
    setSpoken({
      places: r.data.places.map((p, i) => ({ key: `s-p-${stamp}-${i}`, kind: p.kind, name: p.name, note: "말씀하신 내용" })),
      types: r.data.meetingTypes.map((t, i) => ({ key: `s-t-${stamp}-${i}`, name: t.name, durationMin: t.durationMin, note: "말씀하신 내용" })),
    })
    if (!r.data.places.length && !r.data.meetingTypes.length) setNotice({ tone: "neutral", text: "새로 등록할 장소나 미팅 양식을 찾지 못했어요. 이미 등록된 것은 다시 제안하지 않아요." })
    else setText("")
  }

  return (
    <Card className="mb-6 space-y-4">
      <SectionHeader
        title="제안으로 채우기"
        description="지난 8주 업무 일정에서 자주 나온 장소와 미팅 길이, 또는 말씀하신 내용으로 제안해요. 추가하기 전에는 다른 사람에게 보이지 않아요."
        className="mb-0"
      />
      {!suggestions.available ? (
        <p className="text-small text-muted">
          Calendar에서 일정을 가져오면 자주 쓰던 장소와 미팅 길이를 제안해 드려요.{" "}
          <Link href="/settings/calendars" className={buttonClass("link")}>Calendar 연결</Link>
        </p>
      ) : suggestions.places.length + suggestions.meetingTypes.length === 0 ? (
        <p className="text-small text-muted">
          {suggestions.basedOn === 0
            ? "업무로 분류된 지난 일정이 없어 제안할 게 없어요. 내 시간 프로필에서 가져온 일정을 분석하면 업무 일정을 찾아요."
            : `업무 일정 ${suggestions.basedOn}건에서 두 번 이상 반복된 새 장소나 미팅 길이를 찾지 못했어요.`}
        </p>
      ) : null}
      <form onSubmit={ask} className="space-y-2">
        <label className="block">
          <span className="mb-1.5 block text-small font-medium text-ink-soft">말로 알려 주기</span>
          <Textarea aria-label="장소와 미팅 양식 설명" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 30분 커피챗이랑 1시간 상담을 해요. 강남역 근처나 온라인으로 만나요." />
        </label>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !text.trim()}>{busy && <Spinner />}제안 받기</Button>
        </div>
      </form>
      {notice && <Alert tone={notice.tone} role="status">{notice.text}</Alert>}
      {places.length > 0 && (
        <section aria-label="제안된 장소" className="space-y-2">
          <h3 className="text-small font-semibold text-ink-soft">장소</h3>
          <ul className="space-y-2">{places.map((p) => <PlaceRow key={p.key} item={p} onAdded={done(p.key)} />)}</ul>
        </section>
      )}
      {types.length > 0 && (
        <section aria-label="제안된 미팅 양식" className="space-y-2">
          <h3 className="text-small font-semibold text-ink-soft">미팅 양식</h3>
          <ul className="space-y-2">{types.map((t) => <TypeRow key={t.key} item={t} onAdded={done(t.key)} />)}</ul>
        </section>
      )}
    </Card>
  )
}
