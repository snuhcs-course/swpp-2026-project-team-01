import { describe, expect, it } from "vitest"
import { CLASSIFICATION_SCHEMA_VERSION, classifyEvents } from "@/llm/classify"
import { ModelTruncatedError, type ChatClient, type ChatMessage, type ChatOptions } from "@/llm/ollama"

const events = (n: number, idLength = 12) => Array.from({ length: n }, (_, i) => ({ eventId: `id-${i}-`.padEnd(idLength, "x"), title: `title ${i}`, startMs: 1000 + i, endMs: 2000 + i }))
const payload = (messages: ChatMessage[]) => JSON.parse(messages[1].content) as { i: number; title: string }[]
/** Labels every entry business when its index is even, personal otherwise. */
const byParity = (messages: ChatMessage[]) => {
  const items = payload(messages)
  return JSON.stringify({ business: items.filter(e => e.i % 2 === 0).map(e => e.i), personal: items.filter(e => e.i % 2 === 1).map(e => e.i), unknown: [] })
}

describe("event classification", () => {
  it("sends only small integers to the model and maps answers back to provider IDs of any length", async () => {
    const list = events(40, 1000), sent: string[] = []
    const client: ChatClient = { chat: async messages => { sent.push(messages[1].content); return byParity(messages) } }
    const result = await classifyEvents(client, list)
    expect(sent).toHaveLength(1)
    expect(sent[0]).not.toContain("xxxx")
    expect(sent[0].length).toBeLessThan(40 * 120)
    expect(result.failed).toBe(false)
    expect(result.classifications).toHaveLength(40)
    expect(result.classifications.find(c => c.eventId === list[3].eventId)?.classification).toBe("personal")
    expect(result.classifications.find(c => c.eventId === list[4].eventId)?.classification).toBe("business")
  })
  it("sizes the output budget from the batch, with room for the compact answer", async () => {
    const budgets: (number | undefined)[] = []
    const client: ChatClient = { chat: async (messages, options?: ChatOptions) => { budgets.push(options?.numPredict); return byParity(messages) } }
    await classifyEvents(client, events(40)); await classifyEvents(client, events(5))
    expect(budgets[0]).toBeGreaterThanOrEqual(40 * 12); expect(budgets[1]).toBeLessThan(budgets[0]!)
  })
  it("halves the batch when the model is cut off, instead of repeating the same request", async () => {
    const sizes: number[] = []
    const client: ChatClient = { chat: async messages => { const n = payload(messages).length; sizes.push(n); if (n > 10) throw new ModelTruncatedError(); return byParity(messages) } }
    const result = await classifyEvents(client, events(40))
    expect(result.failed).toBe(false); expect(result.classifications).toHaveLength(40)
    expect(sizes).toEqual([40, 20, 10, 10, 20, 10, 10])
    expect(result.stats.truncated).toBe(3); expect(result.stats.splits).toBeGreaterThan(0)
  })
  it("stops at once when the service is unavailable", async () => {
    let calls = 0
    const result = await classifyEvents({ chat: async () => { calls++; throw new Error("offline") } }, events(10))
    expect(calls).toBe(1); expect(result.failed).toBe(true); expect(result.stats.unavailable).toBe(true)
  })
  it("bounds the number of model calls even if every answer is unusable", async () => {
    let calls = 0
    const result = await classifyEvents({ chat: async () => { calls++; return "{not json" } }, events(40))
    expect(calls).toBeLessThanOrEqual(12); expect(result.failed).toBe(true)
  })
  it("keeps valid items and re-asks only for the missing ones", async () => {
    const seen: number[] = []
    const client: ChatClient = { chat: async messages => {
      const items = payload(messages); seen.push(items.length)
      // The first answer omits index 2 and invents index 99.
      return seen.length === 1 ? JSON.stringify({ business: [0, 1, 99], personal: [3], unknown: [] }) : JSON.stringify({ unknown: items.map(e => e.i) })
    } }
    const result = await classifyEvents(client, events(4))
    expect(seen).toEqual([4, 1])
    expect(result.classifications).toHaveLength(4)
    expect(result.classifications.find(c => c.eventId === events(4)[2].eventId)?.classification).toBe("unknown")
    expect(result.stats.rejectedItems).toBe(1)
  })
  it("tells the model to answer unknown for mixed or unspecified entries, and versions the cache for that rule", async () => {
    let system = ""
    await classifyEvents({ chat: async messages => { system = messages[0].content; return byParity(messages) } }, events(2))
    expect(system).toMatch(/MUST answer unknown/)
    expect(CLASSIFICATION_SCHEMA_VERSION).toBe(2)
  })
  it("rejects batches above the documented size", async () => {
    await expect(classifyEvents({ chat: async () => "{}" }, events(41))).rejects.toThrow(RangeError)
  })
})
