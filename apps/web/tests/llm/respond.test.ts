import { describe, expect, it } from "vitest"
import type { Summary } from "@/core/types"
import type { ChatClient } from "@/llm/ollama"
import { OllamaHttpError } from "@/llm/ollama"
import { buildRespondMessages, respond, templateReply, type RespondContext } from "@/llm/respond"
import { NEAR, ONLINE, PLACES, T, T30, T60 } from "../core/helpers"

const summary = (over: Partial<Summary> = {}): Summary => ({
  count: 42,
  firstDate: "2026-10-06",
  lastDate: "2026-10-09",
  byWeek: [{ weekStart: "2026-10-05", count: 42 }],
  byWeekday: [0, 0, 10, 12, 20, 0, 0],
  byTimeOfDay: { morning: 0, afternoon: 42, evening: 0 },
  byPlace: { [ONLINE.id]: 30, [NEAR.id]: 12 },
  byMeetingType: { [T30.id]: 42 },
  topScore: 13,
  tieCountAtTop: 12,
  relax: {},
  ...over,
})

const ctx = (over: Partial<RespondContext> = {}): RespondContext => ({
  nowMs: T("2026-09-29", "10:00"),
  places: PLACES,
  meetingTypes: [T30, T60],
  filter: { weekdays: { days: [2, 3, 4], strength: "must" } },
  summary: summary(),
  optionsShown: false,
  interpretFailed: false,
  llmUnavailable: false,
  askMeetingType: false,
  changes: { added: [], replaced: [], removed: [] },
  basis: null,
  sameAsBefore: false,
  history: [{ role: "user", content: "다음 주 오후" }],
  ...over,
})

describe("buildRespondMessages", () => {
  it("shows the model names, not ids, and never a slot list", () => {
    const msgs = buildRespondMessages(ctx())
    const last = msgs[msgs.length - 1].content
    expect(last).toContain("온라인 30개")
    expect(last).toContain("회사 근처 카페 12개")
    expect(last).not.toContain(ONLINE.id)
    expect(last).toContain("화–목 · 반드시")
    expect(msgs[0].role).toBe("system")
    expect(msgs.some((m) => m.role === "user" && m.content === "다음 주 오후")).toBe(true)
  })
})

describe("templateReply", () => {
  it("explains what relaxing would free up when nothing matches", () => {
    const text = templateReply(ctx({ summary: summary({ count: 0, relax: { weekdays: 7, timeOfDay: 3 } }) }))
    expect(text).toContain("요일 조건을 풀면 7개")
    expect(text).toContain("시간대 조건을 풀면 3개")
  })
  it("mentions buttons when shown, and the count otherwise", () => {
    expect(templateReply(ctx({ optionsShown: true }))).toContain("아래")
    expect(templateReply(ctx())).toContain("42개")
  })
  it("tells the user about a failed interpretation", () => {
    expect(templateReply(ctx({ interpretFailed: true }))).toContain("이해하지 못했어요")
  })
})

describe("respond (call ②)", () => {
  it("cleans up fences and bold markers", async () => {
    const client: ChatClient = { chat: async () => "```\n**42개**가 남았어요.\n```" }
    expect((await respond(client, ctx())).text).toBe("42개가 남았어요.")
  })
  it("falls back to the template when the call fails or is empty, and says which", async () => {
    const fail: ChatClient = { chat: async () => { throw new OllamaHttpError(429) } }
    const r1 = await respond(fail, ctx())
    expect(r1).toMatchObject({ text: templateReply(ctx()), fallback: true, unavailable: true })
    const empty: ChatClient = { chat: async () => "   " }
    expect(await respond(empty, ctx())).toMatchObject({ text: templateReply(ctx()), fallback: true, unavailable: false })
  })

  it("makes no call at all when the service is already known to be down", async () => {
    let calls = 0
    const client: ChatClient = { chat: async () => { calls += 1; return "x" } }
    const r = await respond(client, ctx({ llmUnavailable: true }))
    expect(calls).toBe(0)
    expect(r).toMatchObject({ fallback: true, unavailable: true })
    expect(r.text).toContain("AI 응답을 받지 못했어요")
  })

  it("reports how long the call took", async () => {
    const client: ChatClient = { chat: async () => "ok" }
    expect((await respond(client, ctx())).ms).toBeGreaterThanOrEqual(0)
  })
})

describe("asking for the meeting length", () => {
  it("tells the model to ask about the length first, with the real options", () => {
    const msgs = buildRespondMessages(ctx({ askMeetingType: true }))
    const last = msgs[msgs.length - 1].content
    expect(last).toContain('"askMeetingType":true')
    expect(last).toContain("30분 커피챗(30분)")
    expect(last).toContain("60분 상담(60분)")
    expect(msgs[0].content).toContain("미팅 길이")
  })
  it("omits the length options when it is not being asked", () => {
    expect(buildRespondMessages(ctx()).at(-1)!.content).not.toContain("미팅_양식")
  })
  it("the fallback template asks about the length too", () => {
    expect(templateReply(ctx({ askMeetingType: true }))).toContain("미팅 길이는 어떻게 할까요? (30분, 60분)")
    expect(templateReply(ctx({ askMeetingType: true, optionsShown: true }))).not.toContain("미팅 길이")
  })
  it("distinguishes an unreachable service from a failed interpretation", () => {
    expect(templateReply(ctx({ llmUnavailable: true }))).toContain("AI 응답을 받지 못했어요")
    expect(templateReply(ctx({ interpretFailed: true }))).toContain("이해하지 못했어요")
  })
})

describe("explaining the choice", () => {
  const basis = {
    must: ["평일"],
    preferred: ["12:00–18:00(강하게 선호)"],
    order: "날짜가 가까운 순, 같은 날은 이른 시각 순",
    diversified: true,
    minGapMin: 60,
    options: [
      { label: "10월 5일(월) 12:30 · 온라인 · 30분 커피챗", matched: ["12:00–18:00"], missed: [], slackMin: 90 },
      { label: "10월 6일(화) 17:30 · 회사 근처 카페 · 60분 상담", matched: ["12:00–18:00"], missed: [], slackMin: 30 },
    ],
  }
  const withBasis = () => ctx({ optionsShown: true, basis, changes: { added: ["빠른 순"], replaced: ["12:00–18:00 · 강"], removed: ["온라인 · 강"] } })

  it("hands the model the code-computed basis, the changes, and the rule to explain them", () => {
    const msgs = buildRespondMessages(withBasis())
    const last = msgs.at(-1)!.content
    expect(last).toContain('"이번_턴_변경":{"추가":["빠른 순"],"교체":["12:00–18:00 · 강"],"삭제":["온라인 · 강"]}')
    expect(last).toContain('"반드시_조건":["평일"]')
    expect(last).toContain('"정렬":"날짜가 가까운 순, 같은 날은 이른 시각 순"')
    expect(last).toContain("건너뜀")
    expect(last).toContain('"맞춘_선호":["12:00–18:00"]')
    expect(msgs[0].content).toContain("어떤 기준에서 어떻게 골랐는지")
  })

  it("leaves the basis out when no buttons are shown", () => {
    expect(buildRespondMessages(ctx({ basis })).at(-1)!.content).not.toContain("선택_기준")
  })

  it("the fallback sentence states what was applied, the criteria, and that picks are distinct", () => {
    const text = templateReply(withBasis())
    expect(text).toContain("‘빠른 순’, ‘12:00–18:00 · 강’ 조건을 반영해서")
    expect(text).toContain("‘온라인 · 강’ 조건은 빼고")
    expect(text).toContain("‘평일’은(는) 반드시 지키고")
    expect(text).toContain("12:00–18:00(강하게 선호) 조건에 맞는 것을 앞에 두고")
    expect(text).toContain("날짜가 가까운 순, 같은 날은 이른 시각 순 기준으로 서로 60분 이상 떨어진 후보 2개를 골랐어요.")
    expect(text).toContain("아래 버튼")
  })

  it("says so when the best options have not changed", () => {
    const text = templateReply(ctx({ sameAsBefore: true }))
    expect(text).toContain("직전과 같아요")
    expect(buildRespondMessages(ctx({ sameAsBefore: true })).at(-1)!.content).toContain('"sameAsBefore":true')
  })

  it("when buttons are re-shown at the user's request and are unchanged, says why they are the same", () => {
    const text = templateReply({ ...withBasis(), sameAsBefore: true })
    expect(text).toContain("결과는 직전과 같아요")
    expect(text).toContain("골랐어요")
    expect(text).toContain("아래 버튼")
  })

  it("acknowledges a change even when no buttons are shown", () => {
    expect(templateReply(ctx({ changes: { added: ["평일 · 반드시"], replaced: [], removed: [] } }))).toContain("‘평일 · 반드시’ 조건을 반영했어요.")
  })
})
