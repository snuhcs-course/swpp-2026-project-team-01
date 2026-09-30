import { filterChips } from "@/core/chips"
import { basisSentence, type ChipChanges, type SelectionBasis } from "@/core/explain"
import { weekdayKo } from "@/core/time"
import type { Filter, FilterKey, MeetingType, Place, Summary } from "@/core/types"
import { classifyFailure, type ChatClient, type ChatMessage } from "./ollama"
import type { HistoryMessage } from "./interpret"

export interface RespondContext {
  nowMs: number
  places: Place[]
  meetingTypes: MeetingType[]
  filter: Filter
  summary: Summary
  optionsShown: boolean
  /** Call ① could not interpret the message; the filter is unchanged. */
  interpretFailed: boolean
  /** The LLM service could not be reached; no call is made and a fixed message is returned. */
  llmUnavailable: boolean
  /** No meeting type is chosen yet, the host has several, and we are asking a question rather than showing buttons. */
  askMeetingType: boolean
  /** How this turn changed the conditions. */
  changes: ChipChanges
  /** Why the shown options were chosen (null when no buttons are shown). Computed in code. */
  basis: SelectionBasis | null
  /** The best options are the same as the buttons already on screen, so they are not shown again. */
  sameAsBefore: boolean
  history: HistoryMessage[]
}

export interface RespondResult {
  text: string
  /** True when the text came from the template instead of the model. */
  fallback: boolean
  unavailable: boolean
  ms: number
}

const RELAX_LABEL: Record<FilterKey, string> = {
  dateRange: "날짜 범위",
  weekdays: "요일 조건",
  timeOfDay: "시간대 조건",
  places: "장소 조건",
  meetingTypes: "미팅 양식 조건",
  order: "정렬",
  slack: "여유 조건",
}

const md = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`

function readableSummary(ctx: RespondContext) {
  const s = ctx.summary
  const name = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? id
  return {
    남은_후보_수: s.count,
    가장_이른_날짜: s.firstDate && md(s.firstDate),
    가장_늦은_날짜: s.lastDate && md(s.lastDate),
    주별: s.byWeek.map((w) => `${md(w.weekStart)}부터 한 주: ${w.count}개`),
    요일별: s.byWeekday.map((c, d) => (c > 0 ? `${weekdayKo(d)} ${c}개` : null)).filter(Boolean),
    시간대별: { 오전: s.byTimeOfDay.morning, 오후: s.byTimeOfDay.afternoon, 저녁: s.byTimeOfDay.evening },
    장소별: Object.entries(s.byPlace).map(([id, c]) => `${name(ctx.places, id)} ${c}개`),
    양식별: Object.entries(s.byMeetingType).map(([id, c]) => `${name(ctx.meetingTypes, id)} ${c}개`),
    최고점_동점_수: s.tieCountAtTop,
    조건을_풀면: Object.entries(s.relax).map(([k, c]) => `${RELAX_LABEL[k as FilterKey]}을 풀면 ${c}개`),
  }
}

const SYSTEM_PROMPT = `너는 미팅 예약 앱의 친절한 예약 도우미다. 사용자에게 한국어 존댓말로 1~3문장만 말한다.

절대 규칙:
- 숫자, 날짜, 요일, 장소는 입력의 "요약"에 있는 것만 말한다. 요약에 없는 시간이나 날짜를 지어내지 않는다.
- 예약을 대신 확정하거나 보내지 않는다. 사용자가 버튼을 눌러 직접 요청한다.
- 마크다운, 목록, 이모지를 쓰지 않는다.

상황별 말하기:
- 후보 버튼을 보여준 경우(optionsShown=true): "선택_기준"을 근거로 **어떤 기준에서 어떻게 골랐는지**를 1~3문장으로 설명하고, 후보를 아래 버튼으로 보여드렸다고 말한다.
  - 이번_턴_변경이 있으면 그 조건을 반영했다고 먼저 말한다.
  - 반드시_조건, 선호_조건, 정렬 기준 중 이번 선택에 실제로 작용한 것을 말한다. 후보_다양화가 true이면 서로 시간이 다른 후보로 골랐다고 말한다.
  - 후보별의 못맞춘_선호가 있으면 어떤 선호를 못 맞췄는지 짧게 알린다.
  - "선택_기준"에 없는 이유는 만들지 않는다. 버튼의 시각을 나열하지 않는다.
- 직전 후보와 같은 경우(sameAsBefore=true):
  - 버튼이 없으면(optionsShown=false): 조건은 반영했지만 추천 후보가 직전과 같다고 말하고, 위쪽 버튼을 그대로 쓰거나 다른 조건을 더 말해 달라고 안내한다.
  - 버튼을 다시 보여주는 경우(optionsShown=true): 조건을 반영해 다시 골랐지만 이 후보들이 여전히 가장 적합해서 직전과 같다고 말한다. 선택_기준으로 왜 그런지 한 문장 덧붙인다.
- 이번_턴_변경이 있고 버튼이 없는 경우: 무엇을 반영했는지 한 마디로 먼저 확인한 뒤 아래 규칙대로 말한다.
- 남은 후보가 0개: 조건에 맞는 시간이 없다고 말하고, "조건을 풀면"의 숫자를 근거로 어떤 조건을 풀면 몇 개가 생기는지 알려준다.
- 남은 후보가 많고 버튼이 없는 경우: 몇 개가 남았는지, 어디에 몰려 있는지(요일·시간대·장소 중 한두 가지)를 말하고, 좁히기 위해 무엇을 원하는지 질문 하나만 한다. 예: 제일 빠른 시간, 특정 요일, 오전/오후.
- 해석 실패(interpretFailed=true): 방금 말씀을 이해하지 못했다고 말하고, 위쪽 조건 칩을 직접 지우거나 다시 말씀해 달라고 안내한다.
- 미팅 길이 미정(askMeetingType=true)이고 되묻는 경우: 다른 질문보다 먼저 "미팅_양식"에 있는 길이(예: 30분이면 되나요, 60분이 필요한가요?)를 묻는다. 질문은 하나만 한다.`

export function buildRespondMessages(ctx: RespondContext): ChatMessage[] {
  const payload = {
    현재_조건: filterChips(ctx.filter, ctx.places, ctx.meetingTypes).map((c) => c.label),
    요약: readableSummary(ctx),
    optionsShown: ctx.optionsShown,
    interpretFailed: ctx.interpretFailed,
    askMeetingType: ctx.askMeetingType,
    sameAsBefore: ctx.sameAsBefore,
    이번_턴_변경: { 추가: ctx.changes.added, 교체: ctx.changes.replaced, 삭제: ctx.changes.removed },
    ...(ctx.optionsShown && ctx.basis
      ? {
          선택_기준: {
            반드시_조건: ctx.basis.must,
            선호_조건: ctx.basis.preferred,
            정렬: ctx.basis.order,
            후보_다양화: ctx.basis.diversified ? `같은 날 ${ctx.basis.minGapMin}분 안에 시작하는 비슷한 후보(같은 시각의 다른 장소·양식 포함)는 건너뜀` : false,
            후보별: ctx.basis.options.map((o) => ({ 후보: o.label, 맞춘_선호: o.matched, 못맞춘_선호: o.missed, 앞뒤_여유_분: o.slackMin })),
          },
        }
      : {}),
    ...(ctx.askMeetingType ? { 미팅_양식: ctx.meetingTypes.map((t) => `${t.name}(${t.durationMin}분)`) } : {}),
  }
  const recent: ChatMessage[] = ctx.history.slice(-7).map((m) => ({ role: m.role, content: m.content }))
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...recent,
    { role: "user", content: `[시스템 정보 — 사용자가 쓴 말이 아님]\n${JSON.stringify(payload)}\n위 정보를 근거로 사용자에게 답하세요.` },
  ]
}

/** Deterministic fallback used when call ② is skipped or fails. */
export function templateReply(ctx: RespondContext): string {
  if (ctx.llmUnavailable) return "AI 응답을 받지 못했어요. 잠시 후 다시 시도하거나 위쪽 조건 칩으로 직접 조정해 주세요."
  if (ctx.interpretFailed) return "말씀을 이해하지 못했어요. 위쪽 조건 칩을 직접 지우거나 다시 말씀해 주세요."
  const s = ctx.summary
  if (s.count === 0) {
    const relax = Object.entries(s.relax)
      .map(([k, c]) => `${RELAX_LABEL[k as FilterKey]}을 풀면 ${c}개`)
      .join(", ")
    return relax ? `조건에 맞는 시간이 없어요. ${relax}가 생겨요.` : "조건에 맞는 시간이 없어요. 조건을 바꿔 보시겠어요?"
  }
  if (ctx.sameAsBefore && !ctx.optionsShown) return "조건은 반영했지만 추천 후보는 직전과 같아요. 위쪽 버튼을 그대로 쓰시거나, 다른 조건을 더 말씀해 주세요."
  if (ctx.optionsShown && ctx.basis) {
    const same = ctx.sameAsBefore ? "조건을 반영해 다시 골랐지만 결과는 직전과 같아요. " : ""
    return `${same}${basisSentence(ctx.basis, ctx.changes, ctx.basis.options.length)} 아래 버튼에서 골라 주세요.`
  }
  if (ctx.optionsShown) return `조건에 맞는 시간 ${s.count}개 중 추천 후보를 아래에 보여드릴게요.`
  const applied = [...ctx.changes.added, ...ctx.changes.replaced].map((l) => `‘${l}’`)
  const ack = applied.length > 0 ? `${applied.join(", ")} 조건을 반영했어요. ` : ""
  if (ctx.askMeetingType) {
    const lengths = ctx.meetingTypes.map((t) => `${t.durationMin}분`).join(", ")
    return `${ack}조건에 맞는 시간이 ${s.count}개 남았어요. 미팅 길이는 어떻게 할까요? (${lengths})`
  }
  return `${ack}조건에 맞는 시간이 ${s.count}개 남았어요. 원하는 요일이나 시간대, 또는 가장 빠른 시간을 말씀해 주세요.`
}

/** Call ②. Never throws: falls back to a template, and skips the call entirely when the service is down. */
export async function respond(client: ChatClient, ctx: RespondContext): Promise<RespondResult> {
  const started = performance.now()
  const done = (text: string, fallback: boolean, unavailable: boolean): RespondResult => ({ text, fallback, unavailable, ms: performance.now() - started })
  if (ctx.llmUnavailable) return done(templateReply(ctx), true, true)
  try {
    const text = await client.chat(buildRespondMessages(ctx), { numPredict: 300, temperature: 0.3, think: false })
    const cleaned = text
      .replace(/```[a-z]*\n?/g, "")
      .replace(/\*\*/g, "")
      .trim()
    if (cleaned.length > 0) return done(cleaned, false, false)
    return done(templateReply(ctx), true, false)
  } catch (e) {
    const unavailable = classifyFailure(e) === "unavailable"
    return done(templateReply(ctx), true, unavailable)
  }
}
