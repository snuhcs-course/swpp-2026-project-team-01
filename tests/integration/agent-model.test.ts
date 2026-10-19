import { randomUUID } from "node:crypto";
import { streamText } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODEL_LIMITS, sessionIdHash } from "../../lib/server/model-limits";
import { LOCAL_DATABASE_URL, clearServiceWindow, testDatabase } from "./support/database";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";

// The agent's configured model, driven through the real OpenAI provider client
// against a local stand-in for the Responses API. No request leaves the machine.

const db = testDatabase();
let fake: FakeOpenAI;
let agent: { model: Parameters<typeof streamText>[0]["model"]; modelOptions?: { providerOptions?: object } };

type ResolveCallProviderOptions = (input: object) => Record<string, Record<string, unknown>>;
let resolveCallProviderOptions: ResolveCallProviderOptions;

beforeAll(async () => {
  fake = await startFakeOpenAI();
  await clearServiceWindow(db);
  process.env.OPENAI_BASE_URL = fake.baseURL;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL;
  agent = (await import("../../agent/agent")).default as unknown as typeof agent;
  // eve's own call-option resolution, imported by path because the package does
  // not export it.
  ({ resolveCallProviderOptions } = (await import(
    new URL("../../node_modules/eve/dist/src/harness/provider-safety.js", import.meta.url).href
  )) as { resolveCallProviderOptions: ResolveCallProviderOptions });
});

afterAll(async () => {
  await fake.close();
  await db.end();
});

async function indexedSession() {
  const sessionId = `wrun_${randomUUID()}`;
  const inputId = randomUUID();
  const [host] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;

  await db`
    insert into app.agent_sessions
      (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version,
       current_input_id)
    values
      (${sessionId}, ${sessionIdHash(sessionId)}, ${randomUUID()}, 'host_account', ${host!.id}, 1, 'test',
       ${inputId})
  `;

  return { inputId, sessionId };
}

// The provider options eve sends for a turn of this session: the agent's own
// options plus the safety identifier and prompt cache key eve derives.
function turnOptions(sessionId: string) {
  return resolveCallProviderOptions({
    auth: { authenticator: "app", principalId: "host-1", principalType: "user" },
    profile: { provider: agent.model && typeof agent.model === "object" ? agent.model.provider.split(".")[0] : "" },
    providerOptions: agent.modelOptions?.providerOptions ?? { openai: { serviceTier: "default", store: false } },
    session: { sessionId },
  });
}

async function reservations(workId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.model_reservations where work_id = ${workId}
  `;
  return row!.count;
}

describe("agent model", () => {
  it("is gpt-5.6-terra from OpenAI, wrapped by the limit middleware", () => {
    expect(typeof agent.model).toBe("object");
    expect(agent.model).toMatchObject({ modelId: "gpt-5.6-terra", provider: "openai.responses" });
  });

  it("reserves a turn and sends the safety identifier, prompt cache key and enforced limits", async () => {
    const session = await indexedSession();
    const before = fake.requests.length;

    const result = streamText({
      maxOutputTokens: 50_000,
      model: agent.model,
      prompt: "Find me a time next week.",
      providerOptions: turnOptions(session.sessionId) as never,
    });

    expect(await result.text).toBe("Hello from Thyme.");
    const [sent] = fake.requests.slice(before);
    expect(sent).toMatchObject({
      max_output_tokens: MODEL_LIMITS.conversationOutputTokens,
      model: "gpt-5.6-terra",
      prompt_cache_key: sessionIdHash(session.sessionId),
      service_tier: "default",
      store: false,
      stream: true,
    });
    expect(sent!.safety_identifier).toEqual(expect.any(String));
    expect(fake.bodyBytes.at(-1)).toBeLessThan(MODEL_LIMITS.maxInputBytes);
    expect(fake.authorizations.at(-1)).toBe("Bearer sk-test-not-a-real-key");
    expect(await reservations(session.inputId)).toBe(1);
  });

  it("reserves each attempt of a forced retry", async () => {
    const session = await indexedSession();
    const before = fake.requests.length;
    fake.script.push({ kind: "error", status: 500 });

    const result = streamText({
      maxRetries: 2,
      model: agent.model,
      prompt: "Find me a time next week.",
      providerOptions: turnOptions(session.sessionId) as never,
    });

    expect(await result.text).toBe("Hello from Thyme.");
    expect(fake.requests.length - before).toBe(2);
    expect(fake.requests.slice(before).every((sent) => sent.prompt_cache_key === sessionIdHash(session.sessionId))).toBe(
      true,
    );
    expect(await reservations(session.inputId)).toBe(2);
  });

  it("makes no provider request for a session the index does not know", async () => {
    const before = fake.requests.length;
    const errors: unknown[] = [];

    const result = streamText({
      maxRetries: 2,
      model: agent.model,
      onError: ({ error }) => void errors.push(error),
      prompt: "Find me a time next week.",
      providerOptions: turnOptions(`wrun_${randomUUID()}`) as never,
    });

    await expect(result.text).rejects.toThrow();
    expect(errors).toEqual([expect.objectContaining({ code: "unattributed" })]);
    expect(fake.requests.length).toBe(before);
  });
});
