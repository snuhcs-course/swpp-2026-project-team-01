import { describe, expect, it } from "vitest"
import { interpretHostSetup } from "@/llm/host-setup"
import type { ChatClient } from "@/llm/ollama"

const none = { places: [], meetingTypes: [] }
const reply = (value: unknown): ChatClient => ({ chat: async () => JSON.stringify(value) })

describe("host setup from what the host says", () => {
  it("keeps valid items and drops invalid ones item by item", async () => {
    const result = await interpretHostSetup(reply({
      places: [{ kind: "special", name: "강남역 근처" }, { kind: "online", name: "온라인" }, { kind: "home", name: "집" }],
      meetingTypes: [{ name: "커피챗", durationMin: 30 }, { name: "상담", durationMin: 60 }, { name: "이상한 길이", durationMin: 7 }],
    }), { text: "30분 커피챗, 1시간 상담. 강남역 근처나 온라인", existing: none })
    expect(result).toEqual({
      places: [{ kind: "special", name: "강남역 근처" }, { kind: "online", name: "온라인" }],
      meetingTypes: [{ name: "커피챗", durationMin: 30 }, { name: "상담", durationMin: 60 }],
      failed: false, failure: null,
    })
  })

  it("does not propose what the host already has", async () => {
    const result = await interpretHostSetup(reply({ places: [{ kind: "online", name: "줌" }, { kind: "special", name: "강남역" }], meetingTypes: [{ name: "커피챗", durationMin: 30 }] }),
      { text: "강남역이나 줌, 30분 커피챗", existing: { places: [{ id: "p", kind: "online", name: "온라인" }, { id: "q", kind: "special", name: "강남역" }], meetingTypes: [{ id: "t", name: "커피챗", durationMin: 30 }] } })
    expect(result.places).toEqual([])
    expect(result.meetingTypes).toEqual([])
    expect(result.failed).toBe(false)
  })

  it("asks the model nothing for a greeting", async () => {
    let calls = 0
    const result = await interpretHostSetup({ chat: async () => { calls++; return "{}" } }, { text: "안녕하세요", existing: none })
    expect(calls).toBe(0)
    expect(result.failed).toBe(true)
  })

  it("retries unusable output once, and stops at once when the service is down", async () => {
    let calls = 0
    const garbled = await interpretHostSetup({ chat: async () => { calls++; return "not json" } }, { text: "커피챗 30분", existing: none })
    expect(calls).toBe(2)
    expect(garbled).toMatchObject({ failed: true, failure: "unparseable" })
    calls = 0
    const down = await interpretHostSetup({ chat: async () => { calls++; throw new Error("offline") } }, { text: "커피챗 30분", existing: none })
    expect(calls).toBe(1)
    expect(down).toMatchObject({ failed: true, failure: "unavailable", places: [], meetingTypes: [] })
  })
})
