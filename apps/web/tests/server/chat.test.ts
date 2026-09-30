import { beforeEach, describe, expect, it, vi } from "vitest"
import { OllamaHttpError, type ChatClient, type ChatMessage } from "@/llm/ollama"
import type { Db } from "@/server/db/client"
import { getOrCreateConversation } from "@/server/repos/conversations"
import { ChatError, conversationState, removeFilterKey, runTurn } from "@/server/services/chat"
import { computeBookable } from "@/server/services/schedule"
import { addPlace } from "@/server/repos/hosting"
import { NOW, U, freshDb } from "./helpers"

let db: Db
beforeEach(async () => {
  db = (await freshDb()).db
})

/** Answers call ① with the given JSON (or garbage) and call ② with a fixed sentence. */
function fakeLlm(interpretReplies: (object | string)[]) {
  const calls: { kind: "interpret" | "respond"; messages: ChatMessage[] }[] = []
  let i = 0
  const client: ChatClient = {
    async chat(messages) {
      const kind = messages[0].content.includes("조건 해석기") ? "interpret" : "respond"
      calls.push({ kind, messages })
      if (kind === "respond") return "네, 확인했어요."
      const r = interpretReplies[Math.min(i++, interpretReplies.length - 1)]
      return typeof r === "string" ? r : JSON.stringify(r)
    },
  }
  return { client, calls }
}

const nextWeek = { from: "2026-10-12", to: "2026-10-18" } // NOW is Monday 2026-10-05

describe("runTurn", () => {
  it("interprets, filters in code, replies, and persists the exchange", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client, calls } = fakeLlm([
      { set: { dateRange: { ...nextWeek, strength: "must" }, weekdays: { days: [1, 2, 3, 4], strength: "must" }, timeOfDay: { start: "12:00", end: "18:00", strength: "strong" } }, remove: [], showOptions: false },
    ])
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "다음 주 평일 오후" }, NOW)

    expect(calls.map((c) => c.kind)).toEqual(["interpret", "respond"])
    expect(out.filter.weekdays?.days).toEqual([1, 2, 3, 4])
    expect(out.chips.map((c) => c.label)).toEqual(["10/12–10/18 · 반드시", "월–목 · 반드시", "12:00–18:00 · 강"])
    expect(out.count).toBeGreaterThan(3)
    expect(out.options).toBeNull() // many tied slots and no request → ask instead of showing buttons
    expect(out.assistantMessage.content).toBe("네, 확인했어요.")

    const state = await conversationState(db, conv.id, U.jiho, NOW)
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(state.filter).toEqual(out.filter)
    expect(state.count).toBe(out.count)
  })

  it("call ② sees the counts from the new filter, not the old one", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client, calls } = fakeLlm([{ set: { weekdays: { days: [6], strength: "must" } }, remove: [], showOptions: false }])
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "토요일만" }, NOW)
    const respondPayload = calls[1].messages.at(-1)!.content
    expect(respondPayload).toContain(`"남은_후보_수":${out.count}`)
    expect(out.count).toBeGreaterThan(0)
  })

  it("shows at most 3 buttons that are real slots once the user asks for options", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client } = fakeLlm([
      { set: { dateRange: { ...nextWeek, strength: "must" } }, remove: [], showOptions: false },
      { set: { order: "earliest" }, remove: [], showOptions: true },
    ])
    await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "다음 주" }, NOW)
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "제일 빠른 걸로 보여줘" }, NOW)
    expect(out.options).toHaveLength(3)
    const { slots } = await computeBookable(db, U.jiho, U.host, NOW)
    for (const o of out.options!) {
      expect(slots.some((s) => s.startMs === o.startMs && s.placeId === o.placeId && s.meetingTypeId === o.meetingTypeId)).toBe(true)
      expect(o.label).toMatch(/^\d+월 \d+일\([일월화수목금토]\) \d\d:\d\d · .+ · .+$/)
    }
    expect(out.options![0].startMs).toBeLessThanOrEqual(out.options![1].startMs)
    expect((await conversationState(db, conv.id, U.jiho, NOW)).messages.at(-1)?.options).toHaveLength(3)
  })

  it("leaves the filter untouched and says so when the model output is unusable", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client } = fakeLlm([{ set: { order: "earliest" } }])
    await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "빠르게" }, NOW)
    const bad = fakeLlm(["죄송합니다만 이해하지 못했습니다"])
    const out = await runTurn(db, { chat: async (m) => (m[0].content.includes("조건 해석기") ? bad.client.chat(m) : Promise.reject(new Error("down"))) }, { conversationId: conv.id, clientId: U.jiho, text: "???" }, NOW)
    expect(out.filter).toEqual({ order: "earliest" })
    expect(out.assistantMessage.content).toContain("이해하지 못했어요") // template fallback for call ②
  })

  it("rejects other people's conversations and hosts with nothing to book", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client } = fakeLlm([{}])
    await expect(runTurn(db, client, { conversationId: conv.id, clientId: U.hana, text: "hi" }, NOW)).rejects.toBeInstanceOf(ChatError)
    const empty = await getOrCreateConversation(db, U.jiho, U.hana) // hana hosts nothing
    await expect(runTurn(db, client, { conversationId: empty.id, clientId: U.jiho, text: "hi" }, NOW)).rejects.toMatchObject({ code: "not_bookable" })
    await addPlace(db, U.hana, { kind: "online", name: "온라인" })
    await expect(runTurn(db, client, { conversationId: empty.id, clientId: U.jiho, text: "hi" }, NOW)).rejects.toMatchObject({ code: "not_bookable" }) // still no meeting type
  })
})

describe("runTurn — LLM outage", () => {
  const down: ChatClient = { chat: async () => { throw new OllamaHttpError(429) } }

  it("keeps the filter, skips call ②, and reports an outage rather than a misunderstanding", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const counted = { n: 0 }
    const llm: ChatClient = { chat: async (m, o) => { counted.n += 1; return down.chat(m, o) } }
    const out = await runTurn(db, llm, { conversationId: conv.id, clientId: U.jiho, text: "다음 주 오후" }, NOW)
    expect(out.llmUnavailable).toBe(true)
    expect(out.interpretFailed).toBe(false)
    expect(out.filter).toEqual({})
    expect(out.assistantMessage.content).toContain("AI 응답을 받지 못했어요")
    expect(counted.n).toBe(2) // call ① and its one retry; call ② is not attempted
    expect(out.count).toBeGreaterThan(0) // chips and the count still work without the LLM
  })

  it("flags an outage when only call ② fails, keeping the new filter", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const llm: ChatClient = {
      async chat(messages) {
        if (messages[0].content.includes("조건 해석기")) return JSON.stringify({ set: { order: "earliest" }, remove: [], showOptions: false })
        throw new OllamaHttpError(500)
      },
    }
    const out = await runTurn(db, llm, { conversationId: conv.id, clientId: U.jiho, text: "빠르게" }, NOW)
    expect(out.filter).toEqual({ order: "earliest" })
    expect(out.llmUnavailable).toBe(true)
    expect(out.interpretFailed).toBe(false)
    expect(out.assistantMessage.content).not.toContain("이해하지 못했어요")
  })

  it("an unusable model output is a misunderstanding, not an outage", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client } = fakeLlm(["죄송합니다"])
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "???" }, NOW)
    expect(out).toMatchObject({ interpretFailed: true, llmUnavailable: false })
  })
})

describe("runTurn — meeting length and button variety", () => {
  it("asks about the length when none is chosen and buttons are not shown", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client, calls } = fakeLlm([{ set: { dateRange: { ...nextWeek, strength: "must" } }, remove: [], showOptions: false }])
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "다음 주" }, NOW)
    expect(out.options).toBeNull()
    expect(calls[1].messages.at(-1)!.content).toContain('"askMeetingType":true')
  })

  it("does not ask once a length is chosen, or when buttons are shown", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client, calls } = fakeLlm([{ set: { dateRange: { ...nextWeek, strength: "must" }, meetingTypes: { ids: [(await computeBookable(db, U.jiho, U.host, NOW)).meetingTypes[0].id], strength: "must" } }, remove: [], showOptions: false }])
    await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "30분으로 다음 주" }, NOW)
    expect(calls[1].messages.at(-1)!.content).toContain('"askMeetingType":false')

    const conv2 = await getOrCreateConversation(db, U.hana, U.host)
    const shown = fakeLlm([{ set: { order: "earliest" }, remove: [], showOptions: true }])
    await runTurn(db, shown.client, { conversationId: conv2.id, clientId: U.hana, text: "보여줘" }, NOW)
    expect(shown.calls[1].messages.at(-1)!.content).toContain('"askMeetingType":false')
  })

  it("buttons are different times, not one time with different places or lengths", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client } = fakeLlm([{ set: { order: "earliest" }, remove: [], showOptions: true }])
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "빠른 걸로 보여줘" }, NOW)
    const starts = out.options!.map((o) => o.startMs)
    expect(new Set(starts).size).toBe(3)
    for (let i = 1; i < starts.length; i += 1) {
      if (new Date(starts[i]).toDateString() === new Date(starts[i - 1]).toDateString()) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(60 * 60_000)
    }
  })
})

describe("runTurn — repeated buttons and relative requests", () => {
  it("does not show the same buttons twice unless asked, and says so", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client, calls } = fakeLlm([
      { set: { order: "earliest" }, remove: [], showOptions: true },
      { set: {}, remove: [], showOptions: false }, // nothing changes, so the best 3 are the same as on screen
      { set: {}, remove: [], showOptions: true }, // explicitly asked again
    ])
    const first = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "빠른 걸로 보여줘" }, NOW)
    expect(first.options).toHaveLength(3)

    const second = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "음 그렇구나" }, NOW)
    expect(second.options).toBeNull()
    expect(calls[3].messages.at(-1)!.content).toContain('"sameAsBefore":true')
    expect(second.assistantMessage.content).toBe("네, 확인했어요.") // call ② still writes the reply
    expect((await conversationState(db, conv.id, U.jiho, NOW)).messages.at(-1)?.options).toBeNull()

    const third = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "다시 보여줘" }, NOW)
    expect(third.options).toHaveLength(3)
    expect(calls[5].messages.at(-1)!.content).toContain('"sameAsBefore":true') // shown again on request, and flagged as unchanged
  })

  it("passes the previously shown buttons to call ① so 'a bit later' is relative to them", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client, calls } = fakeLlm([
      { set: { order: "earliest" }, remove: [], showOptions: true },
      { set: {}, remove: [], showOptions: false },
    ])
    const first = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "빠른 걸로 보여줘" }, NOW)
    await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "조금 더 늦은 시간은?" }, NOW)
    const payload = JSON.parse(calls[2].messages[1].content)
    expect(payload.lastShownOptions).toHaveLength(3)
    expect(payload.lastShownOptions[0].date).toBe(new Date(first.options![0].startMs + 9 * 3600_000).toISOString().slice(0, 10))
    const firstPayload = JSON.parse(calls[0].messages[1].content)
    expect(firstPayload.lastShownOptions).toEqual([])
  })

  it("gives call ② the changes and the code-computed basis when buttons are shown", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client, calls } = fakeLlm([{ set: { weekdays: { days: [1, 2, 3, 4], strength: "must" }, order: "earliest" }, remove: [], showOptions: true }])
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "월~목, 빠르게 보여줘" }, NOW)
    expect(out.options).toHaveLength(3)
    const last = calls[1].messages.at(-1)!.content
    expect(last).toContain('"이번_턴_변경":{"추가":["월–목 · 반드시","빠른 순"]')
    expect(last).toContain('"반드시_조건":["월–목"]')
    expect(last).toContain("날짜가 가까운 순, 같은 날은 이른 시각 순")
    expect(last).toContain("후보별")
  })

  it("'latest' picks late times on the nearest days, not the far end of the window", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client } = fakeLlm([{ set: { order: "latest" }, remove: [], showOptions: true }])
    const out = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "가장 늦은 시간대로 보여줘" }, NOW)
    for (const o of out.options!) expect(o.startMs).toBeLessThan(NOW + 3 * 86_400_000)
  })
})

describe("logging", () => {
  it("a turn logs timings and outcomes but never the user's text", async () => {
    const lines: string[] = []
    const env = process.env as Record<string, string | undefined>
    const original = env.NODE_ENV
    env.NODE_ENV = "development"
    const spy = vi.spyOn(console, "log").mockImplementation((l) => void lines.push(String(l)))
    try {
      const conv = await getOrCreateConversation(db, U.jiho, U.host)
      const { client } = fakeLlm([{ set: { order: "earliest" }, remove: [], showOptions: true }])
      await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "비밀스러운 메시지 본문" }, NOW)
    } finally {
      env.NODE_ENV = original
      spy.mockRestore()
    }
    const turn = lines.map((l) => JSON.parse(l)).find((l) => l.event === "chat.turn")
    expect(turn).toMatchObject({
      interpret: { attempts: 1, failure: null, set: ["order"], showOptions: true },
      respond: { fallback: false },
      buttons: "requested",
    })
    expect(typeof turn.totalMs).toBe("number")
    expect(lines.join("\n")).not.toContain("비밀스러운")
  })
})

describe("removeFilterKey", () => {
  it("drops one condition and recomputes without calling the LLM", async () => {
    const conv = await getOrCreateConversation(db, U.jiho, U.host)
    const { client } = fakeLlm([{ set: { weekdays: { days: [6], strength: "must" }, order: "earliest" }, remove: [], showOptions: false }])
    const before = await runTurn(db, client, { conversationId: conv.id, clientId: U.jiho, text: "토요일 빠르게" }, NOW)
    const after = await removeFilterKey(db, conv.id, U.jiho, "weekdays", NOW)
    expect(after.filter).toEqual({ order: "earliest" })
    expect(after.count).toBeGreaterThan(before.count)
    expect(after.options).toHaveLength(3) // an explicit order settles the top 3
  })
})
