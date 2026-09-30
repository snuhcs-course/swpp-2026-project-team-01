import { z } from "zod"
import {
  DAY_MS,
  HORIZON_DAYS,
  kstDateString,
  kstDayStart,
  kstParts,
  kstTimeString,
  kstWeekStart,
  parseHm,
  parseKstDate,
  weekdayKo,
} from "@/core/time"
import { FILTER_KEYS } from "@/core/types"
import type { Filter, FilterChange, FilterKey, MeetingType, Place } from "@/core/types"
import { ModelOutputError, classifyFailure, extractJson, type ChatClient, type ChatMessage, type LlmFailure } from "./ollama"

export interface HistoryMessage {
  role: "user" | "assistant"
  content: string
}

export interface ShownOption {
  startMs: number
  placeId: string
  meetingTypeId: string
}

export interface InterpretContext {
  nowMs: number
  places: Place[]
  meetingTypes: MeetingType[]
  filter: Filter
  history: HistoryMessage[]
  /** The buttons the user was last shown, so relative requests ("조금 더 늦은 시간") have something to be relative to. */
  lastShown?: ShownOption[]
}

export interface InterpretResult {
  change: FilterChange
  showOptions: boolean
  /** True when no usable output came back even after one retry; the filter is left untouched. */
  failed: boolean
  /** Why it failed: the service could not be reached, or the model's output was unusable. */
  failure: LlmFailure | null
  attempts: number
  ms: number
}

const SYSTEM_PROMPT = `너는 미팅 예약 앱의 "조건 해석기"다. 사용자의 마지막 메시지를 읽고, 현재 필터를 어떻게 바꿀지 JSON으로만 답한다. 설명·주석·코드블록 없이 JSON 객체 하나만 출력한다.

출력 형식:
{"set": {...}, "remove": [...], "showOptions": false}

set에 넣을 수 있는 키 (바꿀 것만 넣는다. 같은 키를 다시 내면 통째로 교체된다):
- "dateRange": {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","strength":"must|strong|weak"}
- "weekdays": {"days":[0-6 숫자, 0=일 1=월 … 6=토],"strength":"..."}   ← 허용할 요일 "전체 목록"
- "timeOfDay": {"start":"HH:MM","end":"HH:MM","strength":"..."}   ← 미팅 시작 시각의 범위
- "places": {"placeIds":["장소 id",...],"strength":"..."}   ← 허용할 장소 "전체 목록"
- "meetingTypes": {"ids":["양식 id",...],"strength":"..."}   ← 허용할 양식 "전체 목록"
- "order": "earliest" 또는 "latest"   (earliest = 가장 빠른 날짜·시각부터. latest = 날짜는 가까운 순이되 같은 날에서는 "가장 늦은 시각"부터. 가장 먼 날짜를 뜻하지 않는다)
- "slack": {"strength":"strong|weak"}   (앞뒤로 여유 있는 시간, 빡빡하지 않게)

strength 기준:
- must: 반드시/꼭/절대/~만/~는 안 돼/~은 빼줘 (조건에 안 맞으면 후보에서 제외)
- strong: ~이면 좋겠어/~가 좋아/선호
- weak: 가능하면/되도록/웬만하면

규칙:
- 시간대: 오전 08:00–12:00, 오후 12:00–18:00, 저녁 18:00–22:00. 점심은 11:30–13:30. "N시쯤/N시경/N시 정도"는 정확한 한 시각이 아니므로 N시 30분 전부터 N시 1시간 뒤까지의 범위로 한다(예: 6시쯤 → start="17:30", end="19:00"). 시각이 정확히 하나만 필요하면(예: "6시에") 그 시각부터 30분 뒤까지로 한다.
- 상대 표현("조금 더 늦은/이른 시간", "다른 시간대는")은 order가 아니라 timeOfDay로 바꾼다. 기준은 입력의 lastShownOptions다. "조금 더 늦은 시간"이면 lastShownOptions 중 가장 늦은 시작 시각의 30분 뒤부터 22:00까지(start=그 시각+30분, end="22:00", strength=strong). "조금 더 이른 시간"이면 08:00부터 lastShownOptions 중 가장 이른 시작 시각까지(start="08:00", end=그 시각). lastShownOptions가 비어 있으면 timeOfDay를 바꾸지 말고 set을 비운다.
- 부정 표현은 허용 목록으로 바꾼다. 예: 현재 weekdays가 없을 때 "금요일은 안 돼" → weekdays 1,2,3,4 + 토·일도 포함하려면 0,1,2,3,4,6, strength must. "온라인 말고" → places에서 온라인 id만 뺀 목록. 현재 필터에 이미 같은 키가 있으면 그 목록에서 빼서 다시 낸다.
- 날짜는 입력의 calendar 표를 보고 계산한다. "다음 주"는 nextWeek의 월~일, "이번 주"는 thisWeek. 오늘부터 60일 이내만 가능하다. 날짜 하나면 from과 to를 같게 한다.
- 사용자가 조건을 없애 달라고 하면 remove에 키 이름을 넣는다. 예: "온라인 조건은 빼줘" → "remove":["places"].
- showOptions는 사용자가 후보를 "보여줘/추천해줘/골라줘/아무거나 괜찮아/그걸로 해줘"처럼 직접 요구할 때만 true. 그 외에는 false.
- 장소·양식 id는 입력의 places, meetingTypes에 있는 것만 쓴다. 조건과 무관한 메시지(인사 등)는 {"set":{},"remove":[],"showOptions":false}.

예시 (오늘이 2026-09-29 화요일, 다음 주는 2026-10-05~2026-10-11이라고 하자):
사용자: "다음 주 평일 오후에 온라인이면 좋겠어. 금요일은 안 돼"
{"set":{"dateRange":{"from":"2026-10-05","to":"2026-10-11","strength":"must"},"weekdays":{"days":[1,2,3,4],"strength":"must"},"timeOfDay":{"start":"12:00","end":"18:00","strength":"strong"},"places":{"placeIds":["<온라인 id>"],"strength":"strong"}},"remove":[],"showOptions":false}
사용자: "제일 빠른 걸로 보여줘"
{"set":{"order":"earliest"},"remove":[],"showOptions":true}
사용자: "조금 더 늦은 시간은 없어?" (lastShownOptions의 가장 늦은 시작이 14:00)
{"set":{"timeOfDay":{"start":"14:30","end":"22:00","strength":"strong"}},"remove":[],"showOptions":false}`

const strengthS = z.enum(["must", "strong", "weak"])
const softStrengthS = z.enum(["strong", "weak"])

const setSchemas = {
  dateRange: z.object({ from: z.string(), to: z.string(), strength: strengthS }),
  weekdays: z.object({ days: z.array(z.number()), strength: strengthS }),
  timeOfDay: z.object({ start: z.string(), end: z.string(), strength: strengthS }),
  places: z.object({ placeIds: z.array(z.string()), strength: strengthS }),
  meetingTypes: z.object({ ids: z.array(z.string()), strength: strengthS }),
  order: z.enum(["earliest", "latest"]),
  slack: z.object({ strength: softStrengthS }),
} as const

function calendarHints(nowMs: number) {
  const week = (startDate: string) => {
    const start = parseKstDate(startDate)!
    return Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => {
        const ms = start + i * DAY_MS
        return [`${weekdayKo(kstParts(ms).weekday)}`, kstDateString(ms)]
      }),
    )
  }
  const thisMon = kstWeekStart(nowMs)
  const nextMon = kstDateString(parseKstDate(thisMon)! + 7 * DAY_MS)
  return { thisWeek: week(thisMon), nextWeek: week(nextMon) }
}

export function buildInterpretMessages(ctx: InterpretContext): ChatMessage[] {
  const today = kstDayStart(ctx.nowMs)
  const latest = [...ctx.history].reverse().find((m) => m.role === "user")?.content ?? ""
  const payload = {
    today: kstDateString(ctx.nowMs),
    todayWeekday: weekdayKo(kstParts(ctx.nowMs).weekday),
    lastBookableDate: kstDateString(today + (HORIZON_DAYS - 1) * DAY_MS),
    calendar: calendarHints(ctx.nowMs),
    places: ctx.places.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    meetingTypes: ctx.meetingTypes.map((t) => ({ id: t.id, name: t.name, minutes: t.durationMin })),
    currentFilter: ctx.filter,
    lastShownOptions: (ctx.lastShown ?? []).map((o) => ({
      date: kstDateString(o.startMs),
      weekday: weekdayKo(kstParts(o.startMs).weekday),
      start: kstTimeString(o.startMs),
      place: ctx.places.find((pl) => pl.id === o.placeId)?.name ?? o.placeId,
      meetingType: ctx.meetingTypes.find((t) => t.id === o.meetingTypeId)?.name ?? o.meetingTypeId,
    })),
    recentConversation: ctx.history.slice(-7, -1),
    latestUserMessage: latest,
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload) },
  ]
}

/** Validates model output key by key. Bad keys are dropped, out-of-range values are clamped or dropped. */
export function parseInterpretOutput(raw: unknown, ctx: Pick<InterpretContext, "nowMs" | "places" | "meetingTypes">): {
  change: FilterChange
  showOptions: boolean
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ModelOutputError("interpret output is not an object")
  const obj = raw as Record<string, unknown>
  const rawSet = obj.set && typeof obj.set === "object" && !Array.isArray(obj.set) ? (obj.set as Record<string, unknown>) : {}

  const set: Partial<Filter> = {}
  const remove = new Set<FilterKey>()
  const isKey = (k: string): k is FilterKey => (FILTER_KEYS as string[]).includes(k)

  if (Array.isArray(obj.remove)) for (const k of obj.remove) if (typeof k === "string" && isKey(k)) remove.add(k)

  const firstDay = kstDayStart(ctx.nowMs)
  const lastDay = firstDay + (HORIZON_DAYS - 1) * DAY_MS
  const placeIds = new Set(ctx.places.map((p) => p.id))
  const typeIds = new Set(ctx.meetingTypes.map((t) => t.id))

  for (const key of Object.keys(rawSet)) {
    if (!isKey(key)) continue
    const value = rawSet[key]
    if (value === null) {
      remove.add(key)
      continue
    }
    const parsed = setSchemas[key].safeParse(value)
    if (!parsed.success) continue

    switch (key) {
      case "dateRange": {
        const v = parsed.data as z.infer<typeof setSchemas.dateRange>
        let from = parseKstDate(v.from)
        let to = parseKstDate(v.to)
        if (from === null || to === null) break
        if (from > to) [from, to] = [to, from]
        if (to < firstDay || from > lastDay) break
        set.dateRange = {
          from: kstDateString(Math.max(from, firstDay)),
          to: kstDateString(Math.min(to, lastDay)),
          strength: v.strength,
        }
        break
      }
      case "weekdays": {
        const v = parsed.data as z.infer<typeof setSchemas.weekdays>
        const days = [...new Set(v.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
        if (days.length > 0) set.weekdays = { days, strength: v.strength }
        break
      }
      case "timeOfDay": {
        const v = parsed.data as z.infer<typeof setSchemas.timeOfDay>
        const s = parseHm(v.start)
        const e = parseHm(v.end)
        if (s !== null && e !== null && s < e) set.timeOfDay = { start: v.start, end: v.end, strength: v.strength }
        break
      }
      case "places": {
        const v = parsed.data as z.infer<typeof setSchemas.places>
        const ids = [...new Set(v.placeIds.filter((id) => placeIds.has(id)))]
        if (ids.length > 0) set.places = { placeIds: ids, strength: v.strength }
        break
      }
      case "meetingTypes": {
        const v = parsed.data as z.infer<typeof setSchemas.meetingTypes>
        const ids = [...new Set(v.ids.filter((id) => typeIds.has(id)))]
        if (ids.length > 0) set.meetingTypes = { ids, strength: v.strength }
        break
      }
      case "order":
        set.order = parsed.data as "earliest" | "latest"
        break
      case "slack":
        set.slack = parsed.data as { strength: "strong" | "weak" }
        break
    }
  }

  for (const key of Object.keys(set) as FilterKey[]) remove.delete(key)
  return {
    change: { set, remove: [...remove] },
    showOptions: obj.showOptions === true,
  }
}

/** Call ①. One retry on unusable output or a request error, then `failed` with no change. */
export async function interpret(client: ChatClient, ctx: InterpretContext): Promise<InterpretResult> {
  const messages = buildInterpretMessages(ctx)
  const started = performance.now()
  let failure: LlmFailure = "unparseable"
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await client.chat(messages, { json: true, numPredict: 600, temperature: 0, think: false })
      const { change, showOptions } = parseInterpretOutput(extractJson(text), ctx)
      return { change, showOptions, failed: false, failure: null, attempts: attempt, ms: performance.now() - started }
    } catch (e) {
      failure = classifyFailure(e)
    }
  }
  return { change: {}, showOptions: false, failed: true, failure, attempts: 2, ms: performance.now() - started }
}
