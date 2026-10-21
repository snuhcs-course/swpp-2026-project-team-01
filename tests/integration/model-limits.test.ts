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
    expect(await reservations(session.inputId!)).toBe(3);
  });

  it("caps a conversation input at eight attempts", async () => {
    const provider = fakeOpenAI();
    const session = await indexedSession();
    const model = wrap(provider);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await model.doGenerate(call(session.key));
    }

    await expect(model.doGenerate(call(session.key))).rejects.toMatchObject({ code: "attempts_exhausted" });
    expect(provider.doGenerateCalls).toHaveLength(8);
    expect(await reservations(session.inputId!)).toBe(8);

    // A new accepted input on the same session gets its own attempts.
    const nextInput = randomUUID();
    await db`update app.agent_sessions set current_input_id = ${nextInput} where session_id = ${session.sessionId}`;
    await model.doGenerate(call(session.key));
    expect(await reservations(nextInput)).toBe(1);
  });

  it("refuses a ranking check for a closed request", async () => {
    const { requestId } = await createTestRequest(db);
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${requestId}`;
    const model = wrap(fakeOpenAI(), { ranking: { id: randomUUID(), principal: { id: requestId, type: "requester_request" } } });

    await expect(model.doGenerate(call(undefined))).rejects.toMatchObject({ code: "authority_expired" });
  });

  it("caps a synthetic ranking check at two attempts and 2,048 output tokens without a session", async () => {
    const provider = fakeOpenAI();
    // The principal is an open request: the reservation rechecks it.
    const { requestId } = await createTestRequest(db);
    const ranking: RankingWork = { id: randomUUID(), principal: { id: requestId, type: "requester_request" } };
    const model = wrap(provider, { ranking });

    await model.doGenerate(call(undefined, { maxOutputTokens: 4096 }));
    await model.doGenerate(call(undefined));
    await expect(model.doGenerate(call(undefined))).rejects.toMatchObject({ code: "attempts_exhausted" });

    expect(provider.doGenerateCalls.map((sent) => sent.maxOutputTokens)).toEqual([2048, 2048]);
    expect(await reservations(ranking.id)).toBe(2);
  });

  it("gives an unconfirmed request the anonymous cap and counts it as anonymous until it is confirmed", async () => {
    const { requestId } = await createTestRequest(db);
    const rank = () =>
      wrap(fakeOpenAI(), { ranking: { id: randomUUID(), principal: { id: requestId, type: "requester_request" } } }).doGenerate(
        call(undefined),
      );

    // USD 3 at USD 0.60 a reservation is five attempts.
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
      select coalesce(sum(amount_usd), 0)::text as total from app.model_reservations
      where (anonymous or principal_type = 'public_intake')
        and window_start = date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
    `;
    const limits = { anonymousWindowUsd: (Number(spent!.total) + 0.6).toFixed(2), serviceWindowUsd: "1000000.00" };
    const rank = () =>
      wrap(fakeOpenAI(), { limits, ranking: { id: randomUUID(), principal: { id: requestId, type: "requester_request" } } }).doGenerate(
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
    const provider = fakeOpenAI();
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
    expect(total!.sum).toBe("30.00");
  });

  it("reserves only the service's remaining capacity under concurrent work", async () => {
    const [current] = await db<{ sum: string }[]>`
      select coalesce(sum(amount_usd), 0)::text as sum from app.model_reservations
      where window_start = date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
    `;
    // Room for exactly two more attempts service-wide.
    const serviceWindowUsd = (Number(current!.sum) + 1.2).toFixed(2);
    const sessions = await Promise.all(Array.from({ length: 4 }, () => indexedSession()));
    const provider = fakeOpenAI();
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
