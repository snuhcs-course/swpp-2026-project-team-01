import { describe, expect, it } from "vitest"
import { ModelOutputError, OllamaClient, OllamaHttpError, classifyFailure, extractJson, ollamaConfigFromEnv } from "@/llm/ollama"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}
const ok = (content: string) => jsonResponse(200, { message: { role: "assistant", content } })

function client(handler: (req: { key: string; body: Record<string, unknown> }) => Response | Promise<Response>, keys = ["k1", "k2"], timeoutMs = 1000) {
  const calls: { key: string; body: Record<string, unknown> }[] = []
  const fetchMock = (async (_url: string, init: RequestInit) => {
    const call = {
      key: String((init.headers as Record<string, string>).authorization).replace("Bearer ", ""),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    }
    calls.push(call)
    return handler(call)
  }) as unknown as typeof fetch
  return { calls, c: new OllamaClient({ apiUrl: "http://x/api/chat", model: "m", apiKeys: keys, timeoutMs, fetch: fetchMock }) }
}

describe("OllamaClient", () => {
  it("sends all three roles, json mode and think, and returns the content", async () => {
    const { c, calls } = client(() => ok("hi"))
    const out = await c.chat(
      [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
        { role: "assistant", content: "a" },
      ],
      { json: true, think: false, temperature: 0.3, numPredict: 50 },
    )
    expect(out).toBe("hi")
    const body = calls[0].body
    expect((body.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user", "assistant"])
    expect(body.format).toBe("json")
    expect(body.think).toBe(false)
    expect(body.stream).toBe(false)
    expect(body.options).toEqual({ temperature: 0.3, num_predict: 50 })
  })

  it("omits format unless json is requested", async () => {
    const { c, calls } = client(() => ok("hi"))
    await c.chat([{ role: "user", content: "u" }])
    expect(calls[0].body.format).toBeUndefined()
  })

  it("moves to the next key on 429 and succeeds", async () => {
    const { c, calls } = client(({ key }) => (key === "k1" ? jsonResponse(429, {}) : ok("fine")))
    expect(await c.chat([{ role: "user", content: "u" }])).toBe("fine")
    expect(calls.map((x) => x.key)).toEqual(["k1", "k2"])
  })

  it("rotates the starting key between calls", async () => {
    const { c, calls } = client(() => ok("x"))
    await c.chat([{ role: "user", content: "u" }])
    await c.chat([{ role: "user", content: "u" }])
    expect(calls.map((x) => x.key)).toEqual(["k1", "k2"])
  })

  it("does not retry other statuses (e.g. 402 = model needs paid credits)", async () => {
    const { c, calls } = client(() => jsonResponse(402, { error: "secret provider text" }))
    const err = await c.chat([{ role: "user", content: "u" }]).catch((e) => e)
    expect(err).toBeInstanceOf(OllamaHttpError)
    expect(err.status).toBe(402)
    expect(String(err.message)).not.toContain("secret")
    expect(calls).toHaveLength(1)
  })

  it("throws the last status when every key is rate-limited", async () => {
    const { c } = client(() => jsonResponse(429, {}))
    await expect(c.chat([{ role: "user", content: "u" }])).rejects.toMatchObject({ status: 429 })
  })

  it("aborts a stalled request after the timeout", async () => {
    const stalled = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })) as unknown as typeof fetch
    const c = new OllamaClient({ apiUrl: "http://x", model: "m", apiKeys: ["k"], timeoutMs: 20, fetch: stalled })
    await expect(c.chat([{ role: "user", content: "u" }])).rejects.toThrow("aborted")
  })

  it("reads keys and model from env", () => {
    const cfg = ollamaConfigFromEnv({ OLLAMA_API_KEY_1: "a", OLLAMA_API_KEY_3: "c", OLLAMA_MODEL: "gemma4:31b" })
    expect(cfg.apiKeys).toEqual(["a", "c"])
    expect(cfg.model).toBe("gemma4:31b")
    expect(cfg.apiUrl).toBe("https://ollama.com/api/chat")
    expect(cfg.timeoutMs).toBe(20_000)
  })
})

describe("extractJson", () => {
  it("strips code fences", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })
  it("tolerates // comments and trailing commas", () => {
    expect(extractJson('```json\n{\n  "a": [1, 2], // note\n  "b": "x",\n}\n```')).toEqual({ a: [1, 2], b: "x" })
  })
  it("keeps // inside strings", () => {
    expect(extractJson('{"u": "http://a.b", "n": 1,}')).toEqual({ u: "http://a.b", n: 1 })
  })
  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow()
    expect(() => extractJson("{ not: json }")).toThrow()
  })
})

describe("classifyFailure", () => {
  it("bad model output is unparseable; everything else is unavailable", () => {
    expect(() => extractJson("nothing")).toThrow(ModelOutputError)
    expect(classifyFailure(new ModelOutputError("x"))).toBe("unparseable")
    expect(classifyFailure(new OllamaHttpError(402))).toBe("unavailable")
    expect(classifyFailure(new TypeError("fetch failed"))).toBe("unavailable")
    expect(classifyFailure(new Error("aborted"))).toBe("unavailable")
  })
})
