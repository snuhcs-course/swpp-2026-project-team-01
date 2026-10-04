// Ported from kibitzer apps/extension/src/providers/ollamaChat.ts (postChat), origin/dev c1e3101:
// per-call key rotation on 401/403/429, an abort window that covers the body read, temperature 0.
// Differences: a generic chat() with the `assistant` role, and JSON extraction that tolerates code fences.

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface OllamaConfig {
  apiUrl: string
  model: string
  apiKeys: string[]
  timeoutMs?: number
  fetch?: typeof fetch
}

export interface ChatOptions {
  json?: boolean
  numPredict?: number
  temperature?: number
  think?: boolean
}

const RETRYABLE_KEY_STATUSES = new Set([401, 403, 429])

export class OllamaHttpError extends Error {
  constructor(readonly status: number) {
    super(`Ollama request failed with HTTP ${status}`)
    this.name = "OllamaHttpError"
  }
}

export class OllamaResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OllamaResponseError"
  }
}

/** The model answered, but its output was not usable. Distinct from the service being down. */
export class ModelOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ModelOutputError"
  }
}

/** The model hit the output-token limit mid-answer. Retrying the same input at temperature 0 cannot help; shrink the request. */
export class ModelTruncatedError extends ModelOutputError {
  constructor() {
    super("model output was cut off by the token limit")
    this.name = "ModelTruncatedError"
  }
}

export type LlmFailure = "unavailable" | "unparseable"

/** Bad model output is "unparseable"; anything else (HTTP status, timeout, network) is "unavailable". */
export function classifyFailure(error: unknown): LlmFailure {
  return error instanceof ModelOutputError ? "unparseable" : "unavailable"
}

export interface ChatClient {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>
}

export class OllamaClient implements ChatClient {
  private readonly fetchFn: typeof fetch
  private rotation = 0

  constructor(private readonly config: OllamaConfig) {
    if (!config.apiUrl) throw new Error("Ollama apiUrl is required")
    if (!config.model) throw new Error("Ollama model is required")
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis)
  }

  get model(): string {
    return this.config.model
  }

  private orderedKeys(): string[] {
    const pool = this.config.apiKeys.filter(Boolean)
    if (pool.length <= 1) return pool
    const start = this.rotation % pool.length
    this.rotation += 1
    return [...pool.slice(start), ...pool.slice(0, start)]
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: false,
      options: { temperature: options.temperature ?? 0, num_predict: options.numPredict ?? 512 },
    }
    if (options.json ?? false) body.format = "json"
    if (options.think !== undefined) body.think = options.think

    const keys = this.orderedKeys()
    if (keys.length === 0) throw new OllamaHttpError(401)
    const deadline = Date.now() + (this.config.timeoutMs ?? 20_000)
    let lastStatus = 500
    for (let i = 0; i < keys.length; i += 1) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error("LLM request deadline exceeded")
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), remaining)
      try {
        const response = await this.fetchFn(this.config.apiUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${keys[i]}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        lastStatus = response.status
        if (RETRYABLE_KEY_STATUSES.has(response.status) && i + 1 < keys.length) continue
        if (!response.ok) throw new OllamaHttpError(response.status)
        const data = (await response.json()) as Record<string, unknown>
        // Structured output that stopped on the token limit is never complete, however parseable it looks.
        if ((options.json ?? false) && data.done_reason === "length") throw new ModelTruncatedError()
        return messageContent(data)
      } finally {
        clearTimeout(timer)
      }
    }
    throw new OllamaHttpError(lastStatus)
  }
}

export function messageContent(data: Record<string, unknown>): string {
  const message = data.message
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const content = (message as Record<string, unknown>).content
    if (typeof content === "string") return content
  }
  if (typeof data.response === "string") return data.response
  throw new OllamaResponseError("Ollama response did not include message content")
}

export function ollamaConfigFromEnv(env: Record<string, string | undefined> = process.env): OllamaConfig {
  const apiKeys = [env.OLLAMA_API_KEY_1, env.OLLAMA_API_KEY_2, env.OLLAMA_API_KEY_3].filter((k): k is string => !!k)
  return {
    apiUrl: env.OLLAMA_API_URL ?? "https://ollama.com/api/chat",
    model: env.OLLAMA_MODEL ?? "gemma4:31b",
    apiKeys,
    // A stalled call must fail fast: a turn makes up to four calls (two per step, one retry each).
    timeoutMs: 20_000,
  }
}

/** Pulls a JSON object out of model text: strips code fences and, if needed, `//` comments and trailing commas. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) throw new ModelOutputError("no JSON object in model output")
  const body = text.slice(start, end + 1)
  try {
    return JSON.parse(body)
  } catch {
    const cleaned = body
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/(?<=[,\[{"\d\]}]|true|false|null)\s*\/\/[^\n"]*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1")
    try {
      return JSON.parse(cleaned)
    } catch {
      throw new ModelOutputError("model output was not valid JSON")
    }
  }
}
