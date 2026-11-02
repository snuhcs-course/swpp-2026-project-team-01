import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import {
  limitModel,
  type ModelLimitDependencies,
  type ModelLimits,
  type RankingWork,
  SERVICE_ALLOWANCE_LOCK,
  sessionIdHash,
} from "../../lib/server/model-limits";
import { testDatabase } from "./support/database";
import { createTestRequest } from "./support/requests";

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

// Tests other than the service-wide and anonymous ones lift those caps, so
// repeated local runs within one 24-hour window do not exhaust them.
const roomy: Partial<ModelLimits> = { anonymousWindowUsd: "1000000.00", serviceWindowUsd: "1000000.00" };

type FakeModel = MockLanguageModelV4;
type CallOptions = FakeModel["doGenerateCalls"][number];

const reply = {
  content: [{ text: "Hello from Thyme.", type: "text" as const }],
  finishReason: { raw: "stop", unified: "stop" as const },
  usage: {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
    outputTokens: { reasoning: 0, text: 4, total: 4 },
  },
  warnings: [],
};

// A reply that reports no usage: its reservation cannot be settled.
const unmetered = {
  ...reply,
  usage: {
    inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: undefined, total: undefined },
    outputTokens: { reasoning: undefined, text: undefined, total: undefined },
  },
};

// 10 input and 4 output tokens at USD 2.00 and 12.00 per million: 68 millionths.
const REPLY_COST = "0.000068";
const RESERVED = "0.600000";

// A fake OpenAI model: no request ever leaves the process.
function fakeOpenAI(doGenerate: FakeModel["doGenerate"] = async () => reply) {
  return new MockLanguageModelV4({ doGenerate, modelId: "gpt-5.6-terra", provider: "openai.responses" });
}

function wrap(model: FakeModel, deps: Partial<ModelLimitDependencies> = {}) {
  return limitModel(model, () => ({ db, limits: roomy, ...deps }));
}

async function indexedSession(
  options: { state?: string; input?: string | null; principalId?: string } = {},
) {
  const sessionId = `wrun_${randomUUID()}`;
  const inputId = options.input === undefined ? randomUUID() : options.input;
  const principalId = options.principalId ?? randomUUID();

  // The principal is a real host account: the reservation rechecks its standing.
  await db`insert into app.host_accounts (id) values (${principalId}) on conflict (id) do nothing`;
  await db`
    insert into app.agent_sessions
      (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version, state,
       current_input_id)
    values
      (${sessionId}, ${sessionIdHash(sessionId)}, ${randomUUID()}, 'host_account', ${principalId}, 1, 'test',
       ${options.state ?? "active"}, ${inputId})
  `;

  return { inputId, key: sessionIdHash(sessionId), principalId, sessionId };
}

function call(key: string | undefined, overrides: Partial<CallOptions> = {}): CallOptions {
  return {
    prompt: [{ content: [{ text: "Find me a time next week.", type: "text" }], role: "user" }],
    providerOptions: key ? { openai: { promptCacheKey: key } } : {},
    ...overrides,
  };
}

async function reservations(workId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.model_reservations where work_id = ${workId}
  `;
  return row!.count;
}

async function amounts(workId: string) {
  const rows = await db<{ amount: string }[]>`
    select amount_usd::text as amount from app.model_reservations where work_id = ${workId} order by created_at
  `;
  return rows.map((row) => row.amount);
}

describe("model limit middleware", () => {
  it("keeps the wrapped provider and model ID", () => {
    const model = wrap(fakeOpenAI());

    expect(model.provider).toBe("openai.responses");
    expect(model.modelId).toBe("gpt-5.6-terra");
  });

  it("indexes sessions under the prompt cache key eve sends for them", async () => {
    // eve's own call-option resolution, imported from the installed package by path
    // because the package does not export it.
    const { resolveCallProviderOptions } = (await import(
      new URL("../../node_modules/eve/dist/src/harness/provider-safety.js", import.meta.url).href
    )) as {
      resolveCallProviderOptions: (input: object) => { openai?: { promptCacheKey?: string } };
    };
    const sessionId = `wrun_${randomUUID()}`;
    const options = resolveCallProviderOptions({
      auth: null,
      profile: { provider: "openai" },
      providerOptions: { openai: { serviceTier: "default", store: false } },
      session: { sessionId },
    });

    expect(options.openai?.promptCacheKey).toBe(sessionIdHash(sessionId));
  });

  it("denies an unattributable call before any provider request or reservation", async () => {
    const provider = fakeOpenAI();
    const model = wrap(provider);
    const retired = await indexedSession({ state: "retired" });
    const failed = await indexedSession({ state: "failed" });
    const idle = await indexedSession({ input: null });

    for (const params of [
      call(undefined),
      call(sessionIdHash(`wrun_${randomUUID()}`)),
      call(retired.key),
      call(failed.key),
      call(idle.key),
    ]) {
      await expect(model.doGenerate(params)).rejects.toMatchObject({ code: "unattributed" });
    }

    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(await reservations(retired.inputId!)).toBe(0);
  });

  it.each([
    [
      "oversized input",
      "input_too_large",
      (key: string) =>
        call(key, { prompt: [{ content: [{ text: "가".repeat(45_000), type: "text" }], role: "user" }] }),
    ],
    [
      "an attachment",
      "attachment",
      (key: string) =>
        call(key, {
          prompt: [
            {
              content: [
                { text: "See the file.", type: "text" },
                { data: { data: "aGVsbG8=", type: "data" }, mediaType: "text/plain", type: "file" },
              ],
              role: "user",
            },
          ],
        }),
    ],
    [
      "a provider-executed tool",
      "provider_tool",
      (key: string) => call(key, { tools: [{ args: {}, id: "openai.web_search", name: "web_search", type: "provider" }] }),
    ],
    [
      "a provider-executed tool call in history",
      "provider_tool",
      (key: string) =>
        call(key, {
          prompt: [
            {
              content: [{ input: "{}", providerExecuted: true, toolCallId: "c1", toolName: "web_search", type: "tool-call" }],
              role: "assistant",
            },
          ],
        }),
    ],
  ])("rejects %s before reservation", async (_label, code, params) => {
    const provider = fakeOpenAI();
    const session = await indexedSession();

    await expect(wrap(provider).doGenerate(params(session.key))).rejects.toMatchObject({ code });

    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(await reservations(session.inputId!)).toBe(0);
  });

  it("enforces the output cap, storage off and the standard tier over the caller's options", async () => {
    const provider = fakeOpenAI();
    const session = await indexedSession();

    const result = await generateText({
      maxOutputTokens: 100_000,
      maxRetries: 0,
      model: wrap(provider),
      prompt: "Find me a time next week.",
      providerOptions: { openai: { promptCacheKey: session.key, serviceTier: "priority", store: true } },
    });

    expect(result.text).toBe("Hello from Thyme.");
    const [sent] = provider.doGenerateCalls;
    expect(sent!.maxOutputTokens).toBe(4096);
    expect(sent!.providerOptions!.openai).toMatchObject({
      promptCacheKey: session.key,
      serviceTier: "default",
      store: false,
    });
    expect(await reservations(session.inputId!)).toBe(1);
  });

  it("aborts generation that stalls past the deadline", async () => {
    let signal: AbortSignal | undefined;
    const provider = fakeOpenAI(async (options) => {
      signal = options.abortSignal;
      return new Promise(() => {});
    });
    const session = await indexedSession();

    await expect(
      wrap(provider, { limits: { ...roomy, generateTimeoutMs: 100 } }).doGenerate(call(session.key)),
    ).rejects.toMatchObject({ code: "deadline" });
    expect(signal?.aborted).toBe(true);
  });

  it("gives a non-streamed call its total deadline, not the stream idle deadline", async () => {
    const provider = fakeOpenAI(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return reply;
    });
    const session = await indexedSession();

    const model = wrap(provider, { limits: { ...roomy, generateTimeoutMs: 2_000, idleTimeoutMs: 100 } });
    const result = await model.doGenerate(call(session.key));
    expect(result.content).toEqual(reply.content);
  });

  it("aborts an opened stream when no next chunk arrives", async () => {
    let signal: AbortSignal | undefined;
    const provider = new MockLanguageModelV4({
      doStream: async (options) => {
        signal = options.abortSignal;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              controller.enqueue({ id: "t1", type: "text-start" });
              controller.enqueue({ delta: "Hel", id: "t1", type: "text-delta" });
              // ...and then nothing more.
            },
          }),
        };
      },
      modelId: "gpt-5.6-terra",
      provider: "openai.responses",
    });
    const session = await indexedSession();
    const { stream } = await wrap(provider, { limits: { ...roomy, idleTimeoutMs: 100 } }).doStream(
      call(session.key),
    );
    const reader = stream.getReader();
    const received: unknown[] = [];

    await expect(
      (async () => {
        for (;;) {
          const next = await reader.read();
          if (next.done) return;
          received.push(next.value);
        }
      })(),
    ).rejects.toMatchObject({ code: "deadline" });
    expect(received).toHaveLength(3);
    expect(signal?.aborted).toBe(true);
  });

  it("aborts a stream that never opens", async () => {
    const provider = new MockLanguageModelV4({
      doStream: () => new Promise(() => {}),
      modelId: "gpt-5.6-terra",
      provider: "openai.responses",
    });
    const session = await indexedSession();

    await expect(
      wrap(provider, { limits: { ...roomy, idleTimeoutMs: 100 } }).doStream(call(session.key)),
    ).rejects.toMatchObject({ code: "deadline" });
  });

  it("charges every attempt again after a restart, even with no recorded provider response", async () => {
    const session = await indexedSession();
    const crashing = fakeOpenAI(async () => {
      throw new Error("process died after reserving");
    });

    // Two processes, each reserving and then failing without a response.
    await expect(wrap(crashing).doGenerate(call(session.key))).rejects.toThrow("process died");
    await expect(wrap(fakeOpenAI(crashing.doGenerate)).doGenerate(call(session.key))).rejects.toThrow(
      "process died",
    );
    expect(await reservations(session.inputId!)).toBe(2);

    await wrap(fakeOpenAI()).doGenerate(call(session.key));
    expect(await amounts(session.inputId!)).toEqual([RESERVED, RESERVED, REPLY_COST]);
  });

  it("settles a generated result to its actual cost: input, cached input and output tokens at the published prices", async () => {
    const session = await indexedSession();
    const provider = fakeOpenAI(async () => ({
      ...reply,
      usage: {
        inputTokens: { cacheRead: 400, cacheWrite: 0, noCache: 600, total: 1000 },
        outputTokens: { reasoning: 120, text: 380, total: 500 },
      },
    }));

    await wrap(provider).doGenerate(call(session.key));

    // 600 * 2.00 + 400 * 0.20 + 500 * 12.00 = 7,280 millionths of a dollar.
    expect(await amounts(session.inputId!)).toEqual(["0.007280"]);
  });

  it("rounds a settled cost up to a whole millionth and never to zero", async () => {
    const session = await indexedSession();
    const tiny = fakeOpenAI(async () => ({
      ...reply,
      usage: {
        inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0 },
        outputTokens: { reasoning: 0, text: 0, total: 0 },
      },
    }));

    await wrap(tiny).doGenerate(call(session.key));
    // One cached token is 0.2 millionths.
    await wrap(
      fakeOpenAI(async () => ({
        ...reply,
        usage: {
          inputTokens: { cacheRead: 1, cacheWrite: 0, noCache: 0, total: 1 },
          outputTokens: { reasoning: 0, text: 0, total: 0 },
        },
      })),
    ).doGenerate(call(session.key));

    expect(await amounts(session.inputId!)).toEqual(["0.000001", "0.000001"]);
  });

  it("settles a stream when its finish part arrives, and keeps the reservation of a stream cut short", async () => {
    const usage = {
      inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1000, total: 1000 },
      outputTokens: { reasoning: 0, text: 100, total: 100 },
    };
    const streamOf = (parts: unknown[], closes: boolean) =>
      new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          if (closes) controller.close();
        },
      });
    const finishing = new MockLanguageModelV4({
      doStream: async () => ({
        stream: streamOf([
          { type: "stream-start", warnings: [] },
          { id: "t1", type: "text-start" },
          { delta: "Hi", id: "t1", type: "text-delta" },
          { id: "t1", type: "text-end" },
          { finishReason: { raw: "stop", unified: "stop" }, type: "finish", usage },
        ], true) as never,
      }),
      modelId: "gpt-5.6-terra",
      provider: "openai.responses",
    });
    const cut = new MockLanguageModelV4({
      doStream: async () => ({
        stream: streamOf([
          { type: "stream-start", warnings: [] },
          { id: "t1", type: "text-start" },
          { delta: "Hi", id: "t1", type: "text-delta" },
        ], false) as never,
      }),
      modelId: "gpt-5.6-terra",
      provider: "openai.responses",
    });
    const finished = await indexedSession();
    const aborted = await indexedSession();

    const { stream } = await wrap(finishing).doStream(call(finished.key));
    const reader = stream.getReader();
    // The reservation is still the upper bound until the finish part has passed.
    expect(await amounts(finished.inputId!)).toEqual([RESERVED]);
    while (!(await reader.read()).done);
    // 1,000 * 2.00 + 100 * 12.00 = 3,200 millionths of a dollar.
    expect(await amounts(finished.inputId!)).toEqual(["0.003200"]);

    const cutResult = await wrap(cut, { limits: { ...roomy, idleTimeoutMs: 100 } }).doStream(call(aborted.key));
    await cutResult.stream.cancel();
    expect(await amounts(aborted.inputId!)).toEqual([RESERVED]);
  });

  it("keeps the reservation when the provider reports no usage or the model has no listed price", async () => {
    const silent = await indexedSession();
    const unpriced = await indexedSession();

    await wrap(fakeOpenAI(async () => unmetered)).doGenerate(call(silent.key));
    await wrap(
      new MockLanguageModelV4({ doGenerate: async () => reply, modelId: "gpt-unlisted", provider: "openai.responses" }),
    ).doGenerate(call(unpriced.key));

    expect(await amounts(silent.inputId!)).toEqual([RESERVED]);
    expect(await amounts(unpriced.inputId!)).toEqual([RESERVED]);
  });

  it("keeps the reservation of a call the deadline aborted", async () => {
    const session = await indexedSession();
    const provider = fakeOpenAI(() => new Promise(() => {}));

    await expect(
      wrap(provider, { limits: { ...roomy, generateTimeoutMs: 100 } }).doGenerate(call(session.key)),
    ).rejects.toMatchObject({ code: "deadline" });

    expect(await amounts(session.inputId!)).toEqual([RESERVED]);
  });

  it("puts no cap on the attempts of an accepted input, only on the USD windows", async () => {
    const provider = fakeOpenAI();
    const session = await indexedSession();
    const model = wrap(provider);

    // The old cap was eight attempts per input.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await model.doGenerate(call(session.key));
    }

    expect(provider.doGenerateCalls).toHaveLength(10);
    expect(await amounts(session.inputId!)).toEqual(Array(10).fill(REPLY_COST));
  });

  it("refuses a ranking check for a closed request", async () => {
    const { requestId } = await createTestRequest(db);
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${requestId}`;
    const model = wrap(fakeOpenAI(), { ranking: { id: randomUUID(), principal: { id: requestId, type: "requester_request" } } });

    await expect(model.doGenerate(call(undefined))).rejects.toMatchObject({ code: "authority_expired" });
  });

  it("clamps a synthetic ranking check to 2,048 output tokens without a session, with no cap on its attempts", async () => {
    const provider = fakeOpenAI();
    // The principal is an open request: the reservation rechecks it.
    const { requestId } = await createTestRequest(db);
    const ranking: RankingWork = { id: randomUUID(), principal: { id: requestId, type: "requester_request" } };
    const model = wrap(provider, { ranking });

    await model.doGenerate(call(undefined, { maxOutputTokens: 4096 }));
    await model.doGenerate(call(undefined));
    await model.doGenerate(call(undefined));

    expect(provider.doGenerateCalls.map((sent) => sent.maxOutputTokens)).toEqual([2048, 2048, 2048]);
    expect(await reservations(ranking.id)).toBe(3);
  });

  it("gives an unconfirmed request the anonymous cap and counts it as anonymous until it is confirmed", async () => {
    const { requestId } = await createTestRequest(db);
    // Without reported usage each attempt keeps its full reservation.
    const rank = () =>
      wrap(fakeOpenAI(async () => unmetered), { ranking: { id: randomUUID(), principal: { id: requestId, type: "requester_request" } } }).doGenerate(
        call(undefined),
      );

    // USD 3 at the USD 0.60 upper bound is five attempts.
    for (let index = 0; index < 5; index += 1) await rank();
    await expect(rank()).rejects.toMatchObject({ code: "principal_allowance" });
    const marked = await db<{ anonymous: boolean }[]>`
      select distinct anonymous from app.model_reservations where principal_id = ${requestId}
    `;
    expect(marked).toEqual([{ anonymous: true }]);

    // Confirmed, the USD 30 cap applies, counting the USD 3 already reserved.
    await db`update app.requests set contact_confirmed_email = contact_email where id = ${requestId}`;
    await db`
      insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, amount_usd, window_start)
      select 'ranking_check', gen_random_uuid(), 'requester_request', ${requestId}, 0.60,
             date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
      from generate_series(1, 44)
    `;
    await rank();
    await expect(rank()).rejects.toMatchObject({ code: "principal_allowance" });
    const [last] = await db<{ anonymous: boolean }[]>`
      select anonymous from app.model_reservations where principal_id = ${requestId} order by created_at desc limit 1
    `;
    expect(last!.anonymous).toBe(false);
  });

  it("counts an unconfirmed request toward the anonymous allowance, and a live Google identity lifts it", async () => {
    const { requestId } = await createTestRequest(db);
    const [spent] = await db<{ total: string }[]>`
      select (coalesce(sum(amount_usd), 0) + 0.6)::text as total from app.model_reservations
      where (anonymous or principal_type = 'public_intake')
        and window_start = date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
    `;
    // Room for exactly one more upper-bound reservation.
    const limits = { anonymousWindowUsd: spent!.total, serviceWindowUsd: "1000000.00" };
    const rank = () =>
      wrap(fakeOpenAI(async () => unmetered), { limits, ranking: { id: randomUUID(), principal: { id: requestId, type: "requester_request" } } }).doGenerate(
        call(undefined),
      );

    await rank();
    await expect(rank()).rejects.toMatchObject({ code: "anonymous_allowance" });

    await db`
      insert into app.requester_grants (request_id, kind, google_subject_hash, google_email, email_verified, granted_scopes)
      values (${requestId}, 'identity', ${randomUUID()}, 'other@example.test', true, '{}')
    `;
    await rank();
  });

  it("reserves only the principal's remaining capacity under concurrent work", async () => {
    const principalId = randomUUID();
    // USD 28.80 of USD 30 already reserved in this window: room for two attempts.
    await db`
      insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, amount_usd, window_start)
      select 'conversation_input', gen_random_uuid(), 'host_account', ${principalId}, 0.60,
             date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
      from generate_series(1, 48)
    `;
    const sessions = await Promise.all(Array.from({ length: 5 }, () => indexedSession({ principalId })));
    const provider = fakeOpenAI(async () => unmetered);
    const model = wrap(provider);

    const outcomes = await Promise.allSettled(sessions.map((session) => model.doGenerate(call(session.key))));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason.code),
    ).toEqual(["principal_allowance", "principal_allowance", "principal_allowance"]);
    expect(provider.doGenerateCalls).toHaveLength(2);
    const [total] = await db<{ sum: string }[]>`
      select sum(amount_usd)::text as sum from app.model_reservations where principal_id = ${principalId}
    `;
    expect(total!.sum).toBe("30.000000");
  });

  it("holds the upper bound for calls in flight, and frees the difference when they settle", async () => {
    const principalId = randomUUID();
    // USD 28.80 of USD 30 already reserved in this window: room for two upper bounds.
    await db`
      insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, amount_usd, window_start)
      select 'conversation_input', gen_random_uuid(), 'host_account', ${principalId}, 0.60,
             date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
      from generate_series(1, 48)
    `;
    const sessions = await Promise.all(Array.from({ length: 5 }, () => indexedSession({ principalId })));
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const provider = fakeOpenAI(async () => {
      await gate;
      return reply;
    });
    const model = wrap(provider);

    const outcomes = Promise.allSettled(sessions.map((session) => model.doGenerate(call(session.key))));
    const total = async () => {
      const [row] = await db<{ sum: string }[]>`
        select sum(amount_usd)::text as sum from app.model_reservations where principal_id = ${principalId}
      `;
      return row!.sum;
    };

    // Two calls are in flight at the upper bound; the other three were denied
    // before the provider, whatever their actual cost will turn out to be.
    for (let waited = 0; provider.doGenerateCalls.length < 2 && waited < 100; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(provider.doGenerateCalls).toHaveLength(2);
    expect(await total()).toBe("30.000000");

    open();
    const settled = await outcomes;

    expect(settled.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(
      settled.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason.code),
    ).toEqual(["principal_allowance", "principal_allowance", "principal_allowance"]);
    expect(await total()).toBe("28.800136");

    // The settled difference is capacity again.
    await model.doGenerate(call(sessions[0]!.key));
    expect(provider.doGenerateCalls).toHaveLength(3);
  });

  it("reserves only the service's remaining capacity under concurrent work", async () => {
    const [current] = await db<{ sum: string }[]>`
      select coalesce(sum(amount_usd), 0)::text as sum from app.model_reservations
      where window_start = date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
    `;
    // Room for exactly two more upper-bound reservations service-wide.
    const [room] = await db<{ sum: string }[]>`select (${current!.sum}::numeric + 1.2)::text as sum`;
    const serviceWindowUsd = room!.sum;
    const sessions = await Promise.all(Array.from({ length: 4 }, () => indexedSession()));
    const provider = fakeOpenAI(async () => unmetered);
    const model = wrap(provider, { limits: { serviceWindowUsd } });

    const outcomes = await Promise.allSettled(sessions.map((session) => model.doGenerate(call(session.key))));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected").map((outcome) => outcome.reason.code),
    ).toEqual(["service_allowance", "service_allowance"]);
    expect(provider.doGenerateCalls).toHaveLength(2);
  });

  it("authorizes nothing when the session is retired while the call waits for a capacity lock", async () => {
    const provider = fakeOpenAI();
    const session = await indexedSession();
    let locked!: () => void;
    let release!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));

    // Another reservation holds the service lock.
    const holder = db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${SERVICE_ALLOWANCE_LOCK}, 0))`;
      locked();
      await released;
    });
    await lockHeld;

    const waiting = Promise.resolve(wrap(provider).doGenerate(call(session.key)));
    waiting.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    await db`update app.agent_sessions set state = 'retired' where session_id = ${session.sessionId}`;
    release();
    await holder;

    await expect(waiting).rejects.toMatchObject({ code: "authority_expired" });
    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(await reservations(session.inputId!)).toBe(0);
  });

  it("authorizes nothing when the host is suspended while the call waits for a capacity lock", async () => {
    const provider = fakeOpenAI();
    const session = await indexedSession();
    let locked!: () => void;
    let release!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));

    const holder = db.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${SERVICE_ALLOWANCE_LOCK}, 0))`;
      locked();
      await released;
    });
    await lockHeld;

    const waiting = Promise.resolve(wrap(provider).doGenerate(call(session.key)));
    waiting.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    await db`update app.host_accounts set status = 'suspended' where id = ${session.principalId}`;
    release();
    await holder;

    await expect(waiting).rejects.toMatchObject({ code: "authority_expired" });
    expect(provider.doGenerateCalls).toHaveLength(0);
    expect(await reservations(session.inputId!)).toBe(0);
  });
});
