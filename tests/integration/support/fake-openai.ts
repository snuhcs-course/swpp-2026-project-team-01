import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for OpenAI's Responses API, so tests drive the real provider client
// (and the real eve runtime pointed at it with OPENAI_BASE_URL) without a network
// call. Each request takes the next scripted reply; when the script is empty it
// answers with `defaultReply`. Streaming replies use the event shapes OpenAI sent
// for gpt-5.6-terra on 2026-10-19.

export type FakeReply =
  // delayMs holds the reply back, keeping the turn in flight meanwhile.
  | { readonly kind: "text"; readonly text: string; readonly inputTokens?: number; readonly delayMs?: number }
  | { readonly kind: "error"; readonly status: number; readonly code?: string };

export type FakeRequest = Record<string, unknown> & {
  readonly input?: unknown;
  readonly max_output_tokens?: number;
  readonly prompt_cache_key?: string;
  readonly safety_identifier?: string;
  readonly service_tier?: string;
  readonly store?: boolean;
  readonly stream?: boolean;
};

// A reply for the next request whose body contains `includes`, so tests that
// share one stand-in (the browser tests run in parallel) script only their own
// conversation. A rule is used once.
export type FakeRule = { readonly includes: string; readonly reply: FakeReply };

export type FakeOpenAI = {
  readonly baseURL: string;
  readonly rules: FakeRule[];
  readonly requests: FakeRequest[];
  readonly bodyBytes: number[];
  readonly authorizations: string[];
  readonly script: FakeReply[];
  close(): Promise<void>;
};

function usage(inputTokens: number, outputTokens: number) {
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: inputTokens + outputTokens,
  };
}

function responseBody(id: string, model: string, text: string, inputTokens: number, status: string) {
  const message = {
    content: status === "completed" ? [{ annotations: [], logprobs: [], text, type: "output_text" }] : [],
    id: `msg_${id}`,
    role: "assistant",
    status,
    type: "message",
  };

  return {
    created_at: Math.floor(Date.now() / 1000),
    error: null,
    id: `resp_${id}`,
    incomplete_details: null,
    model,
    object: "response",
    output: status === "completed" ? [message] : [],
    service_tier: "default",
    status,
    usage: status === "completed" ? usage(inputTokens, 4) : null,
  };
}

function sse(events: ({ type: string } & Record<string, unknown>)[]) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

export async function startFakeOpenAI(
  defaultReply: FakeReply = { kind: "text", text: "Hello from Thyme." },
  port = 0,
): Promise<FakeOpenAI> {
  const requests: FakeRequest[] = [];
  const bodyBytes: number[] = [];
  const authorizations: string[] = [];
  const script: FakeReply[] = [];
  const rules: FakeRule[] = [];

  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;

    // Test control: POST /__rules adds a rule from another process.
    if (request.method === "POST" && request.url === "/__rules") {
      rules.push(JSON.parse(raw) as FakeRule);
      response.writeHead(204).end();
      return;
    }

    const body = JSON.parse(raw || "{}") as FakeRequest;
    requests.push(body);
    bodyBytes.push(Buffer.byteLength(raw, "utf8"));
    authorizations.push(request.headers.authorization ?? "");

    const ruled = rules.findIndex((rule) => raw.includes(rule.includes));
    const reply = ruled >= 0 ? rules.splice(ruled, 1)[0]!.reply : (script.shift() ?? defaultReply);

    if (reply.kind === "error") {
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: { code: reply.code ?? null, message: "Scripted failure.", type: "server_error" } }),
      );
      return;
    }

    if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));

    const id = randomUUID().replaceAll("-", "");
    const model = typeof body.model === "string" ? body.model : "gpt-5.6-terra";
    const inputTokens = reply.inputTokens ?? 10;

    if (!body.stream) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(responseBody(id, model, reply.text, inputTokens, "completed")));
      return;
    }

    const itemId = `msg_${id}`;
    const item = { content: [], id: itemId, role: "assistant", status: "in_progress", type: "message" };
    const part = { annotations: [], logprobs: [], text: "", type: "output_text" };
    const done = { annotations: [], logprobs: [], text: reply.text, type: "output_text" };

    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      sse([
        { response: responseBody(id, model, "", inputTokens, "in_progress"), sequence_number: 0, type: "response.created" },
        { item, output_index: 0, sequence_number: 1, type: "response.output_item.added" },
        { content_index: 0, item_id: itemId, output_index: 0, part, sequence_number: 2, type: "response.content_part.added" },
        {
          content_index: 0,
          delta: reply.text,
          item_id: itemId,
          logprobs: [],
          output_index: 0,
          sequence_number: 3,
          type: "response.output_text.delta",
        },
        {
          content_index: 0,
          item_id: itemId,
          logprobs: [],
          output_index: 0,
          sequence_number: 4,
          text: reply.text,
          type: "response.output_text.done",
        },
        { content_index: 0, item_id: itemId, output_index: 0, part: done, sequence_number: 5, type: "response.content_part.done" },
        {
          item: { ...item, content: [done], status: "completed" },
          output_index: 0,
          sequence_number: 6,
          type: "response.output_item.done",
        },
        {
          response: responseBody(id, model, reply.text, inputTokens, "completed"),
          sequence_number: 7,
          type: "response.completed",
        },
      ]),
    );
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: listening } = server.address() as AddressInfo;

  return {
    authorizations,
    baseURL: `http://127.0.0.1:${listening}/v1`,
    bodyBytes,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    requests,
    rules,
    script,
  };
}
