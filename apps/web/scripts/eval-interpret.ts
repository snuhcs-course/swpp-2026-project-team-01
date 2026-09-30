// Usage: npx tsx --env-file=.env scripts/eval-interpret.ts [model ...]
// Measures call ① (Korean text → filter change) accuracy and call ①/② latency against Ollama Cloud.
import { DAY_MS, kstDateString, kstDayStart, kstWeekStart, parseHm, parseKstDate } from "@/core/time"
import type { Filter, FilterChange, MeetingType, Place, Summary } from "@/core/types"
import type { ChipChanges } from "@/core/explain"
import { interpret } from "@/llm/interpret"
import { OllamaClient, ollamaConfigFromEnv } from "@/llm/ollama"
import { respond } from "@/llm/respond"
import type { ShownOption } from "@/llm/interpret"

const places: Place[] = [
  { id: "p-near", kind: "office_near", name: "회사 근처 카페" },
  { id: "p-special", kind: "special", name: "강남 스터디카페" },
  { id: "p-online", kind: "online", name: "온라인(Zoom)" },
]
const types: MeetingType[] = [
  { id: "t30", name: "30분 커피챗", durationMin: 30 },
  { id: "t60", name: "60분 상담", durationMin: 60 },
]

const now = Date.now()
const nextMon = parseKstDate(kstWeekStart(now))! + 7 * DAY_MS
const d = (offset: number) => kstDateString(nextMon + offset * DAY_MS)

interface Check {
  label: string
  test: (c: FilterChange, show: boolean) => boolean
}
interface Case {
  name: string
  message: string
  filter?: Filter
  shown?: ShownOption[]
  checks: Check[]
}

const set = (c: FilterChange) => c.set ?? {}
const hm = (s: string | undefined) => (s ? parseHm(s) : null)
const only = (ids: string[] | undefined, want: string[]) => !!ids && ids.length === want.length && want.every((w) => ids.includes(w))

const oct15 = (() => {
  const y = new Date(now + 9 * 3600_000).getUTCFullYear()
  const cand = parseKstDate(`${y}-10-15`)!
  return kstDateString(cand >= kstDayStart(now) ? cand : parseKstDate(`${y + 1}-10-15`)!)
})()

const shownAt = (offset: number, hm: string, place = "p-online"): ShownOption => ({
  startMs: nextMon + offset * DAY_MS + (parseHm(hm) ?? 0) * 60_000,
  placeId: place,
  meetingTypeId: "t30",
})
const shownNoon = [shownAt(1, "12:00"), shownAt(1, "13:00"), shownAt(1, "14:00")]

const cases: Case[] = [
  {
    name: "상대 표현: 조금 더 늦은 시간",
    message: "조금 더 늦은 시간은 없나?",
    shown: shownNoon,
    checks: [
      { label: "timeOfDay 시작이 14:00 이후(~15:30)", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.start) ?? 0) >= 840 && (hm(t.start) ?? 0) <= 930 } },
      { label: "끝이 저녁(≥21:00)", test: (c) => (hm(set(c).timeOfDay?.end) ?? 0) >= 1260 },
      { label: "order를 latest로 두지 않음", test: (c) => set(c).order !== "latest" },
    ],
  },
  {
    name: "N시쯤",
    message: "6시쯤이 좋아",
    checks: [
      { label: "범위가 30분보다 넓음", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.end) ?? 0) - (hm(t.start) ?? 0) >= 60 } },
      { label: "18:00을 포함", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.start) ?? 9999) <= 1080 && (hm(t.end) ?? 0) > 1080 } },
      { label: "18:30도 포함", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.start) ?? 9999) <= 1110 && (hm(t.end) ?? 0) > 1110 } },
    ],
  },
  {
    name: "상대 표현: 조금 더 이른 시간",
    message: "조금 더 이른 시간은?",
    shown: shownNoon,
    checks: [
      { label: "timeOfDay 끝이 12:30 이하", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.end) ?? 99999) <= 750 && (hm(t.end) ?? 0) >= 660 } },
      { label: "시작이 아침(≤09:00)", test: (c) => (hm(set(c).timeOfDay?.start) ?? 99999) <= 540 },
    ],
  },
  {
    name: "상대 표현인데 보여준 후보가 없음",
    message: "조금 더 늦은 시간은 없나?",
    checks: [{ label: "필터를 바꾸지 않음", test: (c) => Object.keys(set(c)).length === 0 }],
  },
  {
    name: "가장 늦은 시간대",
    message: "가장 늦은 시간대로 보여줘",
    checks: [{ label: "order=latest", test: (c) => set(c).order === "latest" }, { label: "showOptions", test: (_c, s) => s }],
  },
  {
    name: "다음 주 평일 오후 온라인, 금요일 절대 안 됨",
    message: "다음 주 평일 오후에 온라인이면 좋겠어. 금요일은 절대 안 돼",
    checks: [
      { label: "날짜=다음 주", test: (c) => !!set(c).dateRange && set(c).dateRange!.from <= d(0) && set(c).dateRange!.to >= d(3) && set(c).dateRange!.from >= d(-1) },
      { label: "요일 월–목 포함·금 제외", test: (c) => { const w = set(c).weekdays?.days; return !!w && [1, 2, 3, 4].every((x) => w.includes(x)) && !w.includes(5) } },
      { label: "요일=must", test: (c) => set(c).weekdays?.strength === "must" },
      { label: "시간대 오후", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.start) ?? 0) >= 660 && (hm(t.start) ?? 0) <= 780 && (hm(t.end) ?? 0) >= 1020 && (hm(t.end) ?? 0) <= 1080 } },
      { label: "장소=온라인만", test: (c) => only(set(c).places?.placeIds, ["p-online"]) },
    ],
  },
  {
    name: "가장 빠른 걸로 보여줘",
    message: "제일 빠른 걸로 보여줘",
    checks: [
      { label: "order=earliest", test: (c) => set(c).order === "earliest" },
      { label: "showOptions", test: (_c, s) => s },
    ],
  },
  {
    name: "저녁 선호",
    message: "오전은 싫고 저녁이 좋아",
    checks: [{ label: "시간대 저녁", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.start) ?? 0) >= 1020 && (hm(t.end) ?? 0) >= 1260 } }],
  },
  {
    name: "주말 제외",
    message: "주말은 안 돼",
    checks: [{ label: "요일 월–금만", test: (c) => only(set(c).weekdays?.days?.map(String), ["1", "2", "3", "4", "5"]) }, { label: "must", test: (c) => set(c).weekdays?.strength === "must" }],
  },
  {
    name: "장소+양식",
    message: "회사 근처에서 30분짜리로 하고 싶어",
    checks: [
      { label: "장소=회사 근처", test: (c) => only(set(c).places?.placeIds, ["p-near"]) },
      { label: "양식=30분", test: (c) => only(set(c).meetingTypes?.ids, ["t30"]) },
    ],
  },
  {
    name: "특정 날짜",
    message: "10월 15일에 만나고 싶어",
    checks: [{ label: `날짜=${oct15}`, test: (c) => set(c).dateRange?.from === oct15 && set(c).dateRange?.to === oct15 }],
  },
  {
    name: "추천 요청",
    message: "아무거나 괜찮으니까 추천해줘",
    checks: [{ label: "showOptions", test: (_c, s) => s }, { label: "필터 변경 없음", test: (c) => Object.keys(set(c)).length === 0 }],
  },
  {
    name: "조건 제거",
    message: "온라인 조건은 빼줘",
    filter: { places: { placeIds: ["p-online"], strength: "strong" } },
    checks: [{ label: "places 제거", test: (c) => (c.remove ?? []).includes("places") }],
  },
  {
    name: "약한 오전 선호",
    message: "가능하면 오전이면 좋겠어",
    checks: [{ label: "시간대 오전", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.start) ?? 99) <= 540 && (hm(t.end) ?? 0) <= 720 && (hm(t.end) ?? 0) >= 660 } }, { label: "약함(weak)", test: (c) => set(c).timeOfDay?.strength === "weak" }],
  },
  {
    name: "여유",
    message: "빡빡하지 않고 여유 있는 시간으로 부탁해",
    checks: [{ label: "slack 설정", test: (c) => !!set(c).slack }],
  },
  {
    name: "다음 주 화/수",
    message: "다음 주 화요일이나 수요일이 좋아",
    checks: [
      { label: "요일={화,수}", test: (c) => only(set(c).weekdays?.days?.map(String), ["2", "3"]) },
      { label: "날짜=다음 주", test: (c) => !!set(c).dateRange && set(c).dateRange!.from <= d(1) && set(c).dateRange!.to >= d(2) },
    ],
  },
  {
    name: "무관한 인사",
    message: "안녕하세요",
    checks: [{ label: "변경 없음", test: (c) => Object.keys(set(c)).length === 0 && (c.remove ?? []).length === 0 }, { label: "showOptions 아님", test: (_c, s) => !s }],
  },
  {
    name: "양식+장소 제외",
    message: "60분 상담으로 하고 강남 스터디카페는 빼줘",
    checks: [
      { label: "양식=60분", test: (c) => only(set(c).meetingTypes?.ids, ["t60"]) },
      { label: "장소: 강남 제외, 나머지 포함", test: (c) => only(set(c).places?.placeIds, ["p-near", "p-online"]) },
    ],
  },
  {
    name: "기존 시간대 교체",
    message: "아 그냥 오전도 괜찮아",
    filter: { timeOfDay: { start: "12:00", end: "18:00", strength: "strong" } },
    checks: [{ label: "시간대가 오전까지 확장", test: (c) => { const t = set(c).timeOfDay; return !!t && (hm(t.start) ?? 99) <= 540 && (hm(t.end) ?? 0) >= 1020 } }],
  },
]

const noChanges: ChipChanges = { added: [], replaced: [], removed: [] }
const sampleBasis = { must: ["월–목"], preferred: ["12:00–18:00(강하게 선호)", "온라인(강하게 선호)"], order: "날짜가 가까운 순, 같은 날은 이른 시각 순", diversified: true, minGapMin: 60, options: [
  { label: "10월 5일(월) 12:30 · 온라인 (Zoom) · 30분 커피챗", matched: ["12:00–18:00", "온라인"], missed: [], slackMin: 90 },
  { label: "10월 5일(월) 14:00 · 회사 근처 카페 · 30분 커피챗", matched: ["12:00–18:00"], missed: ["온라인"], slackMin: 30 },
  { label: "10월 6일(화) 13:00 · 온라인 (Zoom) · 60분 상담", matched: ["12:00–18:00", "온라인"], missed: [], slackMin: 120 },
] }
const respondCases: { name: string; summary: Summary; optionsShown: boolean; filter: Filter; changes?: ChipChanges; basis?: typeof sampleBasis; sameAsBefore?: boolean }[] = [
  { name: "많음/버튼 없음", optionsShown: false, filter: { weekdays: { days: [1, 2, 3, 4], strength: "must" } }, summary: { count: 42, firstDate: "2026-10-06", lastDate: "2026-10-09", byWeek: [{ weekStart: "2026-10-05", count: 42 }], byWeekday: [0, 8, 10, 12, 12, 0, 0], byTimeOfDay: { morning: 0, afternoon: 42, evening: 0 }, byPlace: { "p-online": 30, "p-near": 12 }, byMeetingType: { t30: 42 }, topScore: 13, tieCountAtTop: 12, relax: {} } },
  { name: "0개", optionsShown: false, filter: { weekdays: { days: [6], strength: "must" } }, summary: { count: 0, firstDate: null, lastDate: null, byWeek: [], byWeekday: [0, 0, 0, 0, 0, 0, 0], byTimeOfDay: { morning: 0, afternoon: 0, evening: 0 }, byPlace: {}, byMeetingType: {}, topScore: null, tieCountAtTop: 0, relax: { weekdays: 5 } } },
  { name: "버튼 표시(근거 포함)", optionsShown: true, changes: { added: ["빠른 순"], replaced: ["12:00–18:00 · 강"], removed: ["온라인 · 강"] }, basis: sampleBasis, filter: { order: "earliest" }, summary: { count: 42, firstDate: "2026-10-06", lastDate: "2026-10-09", byWeek: [{ weekStart: "2026-10-05", count: 42 }], byWeekday: [0, 8, 10, 12, 12, 0, 0], byTimeOfDay: { morning: 0, afternoon: 42, evening: 0 }, byPlace: { "p-online": 42 }, byMeetingType: { t30: 42 }, topScore: 0, tieCountAtTop: 42, relax: {} } },
  { name: "직전과 같은 후보", optionsShown: false, sameAsBefore: true, changes: { added: ["앞뒤 여유 · 약"], replaced: [], removed: [] }, filter: { order: "earliest" }, summary: { count: 42, firstDate: "2026-10-06", lastDate: "2026-10-09", byWeek: [{ weekStart: "2026-10-05", count: 42 }], byWeekday: [0, 8, 10, 12, 12, 0, 0], byTimeOfDay: { morning: 0, afternoon: 42, evening: 0 }, byPlace: { "p-online": 42 }, byMeetingType: { t30: 42 }, topScore: 0, tieCountAtTop: 42, relax: {} } },
]

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]

async function main() {
  const base = ollamaConfigFromEnv()
  const models = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["gemma4:31b", "nemotron-3-nano:30b"]
  console.log(`now=${kstDateString(now)}  cases=${cases.length}\n`)

  for (const model of models) {
    const client = new OllamaClient({ ...base, model })
    let pass = 0
    let total = 0
    let failedCalls = 0
    const lat: number[] = []
    const details: string[] = []
    for (const c of cases) {
      const t0 = performance.now()
      const r = await interpret(client, { nowMs: now, places, meetingTypes: types, filter: c.filter ?? {}, history: [{ role: "user", content: c.message }], lastShown: c.shown })
      lat.push(performance.now() - t0)
      if (r.failed) failedCalls += 1
      const results = c.checks.map((k) => ({ label: k.label, ok: !r.failed && k.test(r.change, r.showOptions) }))
      for (const x of results) { total += 1; if (x.ok) pass += 1 }
      const bad = results.filter((x) => !x.ok)
      if (bad.length > 0) details.push(`  ✗ ${c.name}: ${bad.map((b) => b.label).join(", ")}\n    → ${r.failed ? "(호출 실패)" : JSON.stringify({ set: r.change.set, remove: r.change.remove, showOptions: r.showOptions })}`)
    }
    const rlat: number[] = []
    for (const rc of respondCases) {
      const t0 = performance.now()
      const text = await respond(client, { nowMs: now, places, meetingTypes: types, filter: rc.filter, summary: rc.summary, optionsShown: rc.optionsShown, interpretFailed: false, llmUnavailable: false, askMeetingType: rc.name.startsWith("많음"), changes: rc.changes ?? noChanges, basis: rc.basis ?? null, sameAsBefore: rc.sameAsBefore ?? false, history: [{ role: "user", content: "다음 주 오후" }] })
      rlat.push(performance.now() - t0)
      details.push(`  · ${rc.name}: ${text.text.replace(/\n/g, " ")}`)
    }
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    console.log(`=== ${model}`)
    console.log(`정확도 ${pass}/${total} (${Math.round((100 * pass) / total)}%) · 호출 실패 ${failedCalls}/${cases.length}`)
    console.log(`① 해석  p50 ${Math.round(pct(lat, 0.5))}ms · p95 ${Math.round(pct(lat, 0.95))}ms`)
    console.log(`② 응답  p50 ${Math.round(pct(rlat, 0.5))}ms · max ${Math.round(Math.max(...rlat))}ms`)
    console.log(`①+② 평균 합산 ≈ ${Math.round(sum(lat) + sum(rlat))}ms`)
    console.log(details.join("\n"))
    console.log()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
