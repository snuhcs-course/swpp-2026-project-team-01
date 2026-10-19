import { randomUUID } from "node:crypto";
import type { MessageStreamEvent } from "eve/client";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ChatRouteDependencies,
  createEventsHandler,
  createMessageHandler,
  createRecoverHandler,
  createStateHandler,
} from "../../lib/server/chat-routes";
import { type ConversationRuntime, eveRuntime } from "../../lib/server/conversations";
import { limitModel, sessionIdHash } from "../../lib/server/model-limits";
import { localAuthConfig, signInHost } from "./support/auth";
import { clearServiceWindow, testDatabase } from "./support/database";
import { readEvents, waitForTurn } from "./support/eve-calls";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";

// Stored stream events, discussion cursors and explicit terminal recovery
// (task 4.5), against a real `eve dev` agent service whose model is a local
// Responses API stand-in. A scripted 401 is the recorded model-authentication
// failure; eve ends the session with session.failed for it.

const db = testDatabase();
let fake: FakeOpenAI;
let server: EveServer;
let runtime: ConversationRuntime;

beforeAll(async () => {
  fake = await startFakeOpenAI();
  await clearServiceWindow(db);
  server = await startEve("dev", { modelBaseURL: fake.baseURL });
  runtime = eveRuntime(server.url);
}, 300_000);

afterAll(async () => {
  await server?.stop();
  await fake.close();
  await db.end();
});

function routes(overrides: Partial<ChatRouteDependencies> = {}) {
  const deps = { appOrigin: "http://localhost:3000", auth: localAuthConfig(), db, runtime, signingKey: server.signingKey, ...overrides };
  return {
    events: createEventsHandler(() => deps),
    message: createMessageHandler(() => deps),
    recover: createRecoverHandler(() => deps),
    state: createStateHandler(() => deps),
  };
}

type Host = Awaited<ReturnType<typeof signInHost>>;

async function say(host: Host, text: string, deps?: Partial<ChatRouteDependencies>) {
  const response = await routes(deps).message(
    new Request("http://localhost:3000/api/chat/messages", {
      body: JSON.stringify({ clientInputId: randomUUID(), message: text }),
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: host.cookie },
      method: "POST",
    }),
  );
  return { body: (await response.json()) as { inputId: string; status: string }, status: response.status };
}

async function recover(host: Host, observedGeneration: number, deps?: Partial<ChatRouteDependencies>) {
  const response = await routes(deps).recover(
    new Request("http://localhost:3000/api/chat/recover", {
      body: JSON.stringify({ observedGeneration }),
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: host.cookie },
      method: "POST",
    }),
  );
  return {
    body: (await response.json()) as { status: string; generation?: number; delivered?: boolean },
    status: response.status,
  };
}

async function history(host: Host, cursor = 0) {
  const response = await routes().events(
    new Request(`http://localhost:3000/api/chat/events?cursor=${cursor}`, { headers: { cookie: host.cookie } }),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MessageStreamEvent);
}

// The history once the runtime has stopped appending: eve may record an event
// after the turn boundary waitForTurn stops at.
async function settledHistory(host: Host) {
  let previous = await history(host);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = await history(host);
    if (next.length === previous.length) return next;
    previous = next;
  }

  return previous;
}

async function state(host: Host) {
  const response = await routes().state(
    new Request("http://localhost:3000/api/chat/state", { headers: { cookie: host.cookie } }),
  );
  return (await response.json()) as { generation: number | null; state: string; pendingInputs: number };
}

async function sessions(hostAccountId: string) {
  return db<{ session_id: string; generation: number; state: string; current_input_id: string | null }[]>`
    select s.session_id, s.generation, s.state, s.current_input_id
    from app.agent_sessions s join app.discussions d on d.id = s.discussion_id
    where d.principal_id = ${hostAccountId}
    order by s.generation
  `;
}

async function current(hostAccountId: string) {
  return (await sessions(hostAccountId)).at(-1)!;
}

async function reservationsFor(workId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.model_reservations where work_id = ${workId}
  `;
  return row!.count;
}

async function inputState(inputId: string) {
  const [row] = await db<{ state: string }[]>`select state from app.conversation_inputs where id = ${inputId}`;
  return row?.state;
}

async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 60 && !(await check()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(await check()).toBe(true);
}

// A host whose first turn failed on model authentication: generation 1 is
// terminally failed with its input charged once.
async function failedHost() {
  const host = await signInHost(db);
  fake.script.push({ code: "invalid_api_key", kind: "error", status: 401 });
  const sent = await say(host, "Find me a time next week.");
  expect(sent.status).toBe(202);
  const failed = await current(host.hostAccountId);
  const turn = await waitForTurn(server.url, host.cookie, failed.session_id);
  expect(turn.at(-1)?.type).toBe("session.failed");
  await eventually(async () => (await current(host.hostAccountId)).state === "failed");
  return { failed, host, inputId: sent.body.inputId };
}

const texts = (events: readonly MessageStreamEvent[]) =>
  events.flatMap((event) => (event.type === "message.received" ? [`user:${event.data.message}`] : []).concat(
    event.type === "message.completed" ? [`assistant:${event.data.message}`] : [],
  ));

describe("terminal recovery", () => {
  it("recovers a recorded model-authentication failure after the key is corrected, keeping prior charges", async () => {
    const { failed, host, inputId } = await failedHost();
    expect(await reservationsFor(inputId)).toBe(1);
    expect(await state(host)).toMatchObject({ generation: 1, pendingInputs: 1, state: "failed" });

    // The browser sees a safe failure, never the provider's error body.
    const before = await history(host);
    const failure = before.find((event) => event.type === "session.failed")!;
    expect(JSON.stringify(failure)).not.toContain("invalid_api_key");

    // "Key corrected": the stand-in now answers.
    const recovered = await recover(host, 1);
    expect(recovered).toMatchObject({ body: { delivered: true, generation: 2, status: "recovered" }, status: 200 });

    const [old, successor] = await sessions(host.hostAccountId);
    expect(old).toMatchObject({ session_id: failed.session_id, state: "retired" });
    // The pending input continues on the successor with its original identity.
    expect(successor).toMatchObject({ current_input_id: inputId, generation: 2, state: "active" });
    const turn = await waitForTurn(server.url, host.cookie, successor!.session_id);
    expect(turn.at(-1)?.type).toBe("session.waiting");
    expect(await reservationsFor(inputId)).toBe(2);
    await eventually(async () => (await state(host)).pendingInputs === 0);
  });

  it("creates one successor for concurrent and repeated recovery", async () => {
    const { host } = await failedHost();

    const outcomes = await Promise.all([recover(host, 1), recover(host, 1), recover(host, 1)]);
    expect(outcomes.map((outcome) => outcome.body)).toMatchObject(
      Array.from({ length: 3 }, () => ({ generation: 2, status: "recovered" })),
    );
    expect((await sessions(host.hostAccountId)).map((row) => [row.generation, row.state])).toEqual([
      [1, "retired"],
      [2, "active"],
    ]);

    // A retry after a lost response returns the same transition; the live
    // generation cannot be "recovered" again without terminal evidence.
    expect((await recover(host, 1)).body).toMatchObject({ generation: 2, status: "recovered" });
    await waitForTurn(server.url, host.cookie, (await current(host.hostAccountId)).session_id);
    expect((await recover(host, 2)).body).toEqual({ status: "not_failed" });
    expect((await recover(host, 5)).body).toEqual({ generation: 2, status: "stale" });
    expect(await sessions(host.hostAccountId)).toHaveLength(2);
  });

  it("answers a recovery whose successor create lost the race with the winner's transition", async () => {
    const { host } = await failedHost();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    // This recovery's create reaches the agent only after another recovery has
    // indexed the successor, so the agent refuses it.
    const late: ConversationRuntime = {
      ...runtime,
      createSession: async (bearer) => {
        await held;
        return runtime.createSession(bearer);
      },
    };

    const loser = recover(host, 1, { runtime: late });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await recover(host, 1)).body).toMatchObject({ generation: 2, status: "recovered" });
    release();

    expect(await loser).toMatchObject({ body: { generation: 2, status: "recovered" }, status: 200 });
    expect(await sessions(host.hostAccountId)).toHaveLength(2);
  });

  it("refuses uncertain runtime state", async () => {
    // A live session with no failure.
    const live = await signInHost(db);
    await say(live, "Hello.");
    await waitForTurn(server.url, live.cookie, (await current(live.hostAccountId)).session_id);
    expect((await recover(live, 1)).body).toEqual({ status: "not_failed" });

    // Inspection that does not answer in time.
    const { host } = await failedHost();
    const hanging: ConversationRuntime = {
      ...runtime,
      readEvents: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
      }),
    };
    const outcome = await recoverDiscussionWithTimeout(host, hanging);
    expect(outcome).toEqual({ status: "unavailable" });
    expect((await sessions(host.hostAccountId)).map((row) => row.state)).toEqual(["failed"]);

    // No session at all.
    const fresh = await signInHost(db);
    expect((await recover(fresh, 1)).body).toEqual({ generation: null, status: "stale" });
  });

  it("denies recovery when authority is revoked while it waits for its lock", async () => {
    const { host } = await failedHost();
    let release!: () => void;
    const suspended = new Promise<void>((resolve) => (release = resolve));
    let holder: Promise<unknown> | undefined;

    // The host is suspended (and its row held) while recovery creates the successor
    // session; recovery then waits on the host row and must see the suspension.
    const gated: ConversationRuntime = {
      ...runtime,
      async createSession(bearer) {
        const sessionId = await runtime.createSession(bearer);
        let locked!: () => void;
        const isLocked = new Promise<void>((resolve) => (locked = resolve));
        holder = db.begin(async (tx) => {
          await tx`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;
          locked();
          await suspended;
        });
        await isLocked;
        return sessionId;
      },
    };

    const pending = recover(host, 1, { runtime: gated });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await holder;
    const outcome = await pending;

    expect(outcome.status).toBe(403);
    expect(outcome.body).toMatchObject({ code: "host_ineligible" });
    expect((await sessions(host.hostAccountId)).map((row) => row.state)).toEqual(["failed"]);
  });

  it("denies the model when allowance is exhausted during recovery, keeping history readable", async () => {
    const { host, inputId } = await failedHost();
    // USD 30 of the principal's window already reserved.
    await db`
      insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, amount_usd, window_start)
      select 'conversation_input', gen_random_uuid(), 'host_account', ${host.hostAccountId}, 0.60,
             date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
      from generate_series(1, 50)
    `;
    const requests = fake.requests.length;

    expect((await recover(host, 1)).body).toMatchObject({ generation: 2, status: "recovered" });
    const successor = await current(host.hostAccountId);
    const turn = await waitForTurn(server.url, host.cookie, successor.session_id);

    expect(turn.some((event) => event.type === "message.completed")).toBe(false);
    expect(fake.requests.length).toBe(requests);
    expect(await reservationsFor(inputId)).toBe(1);
    // The re-sent input shows once.
    expect(texts(await history(host))).toEqual(["user:Find me a time next week."]);
  });

  it("denies a retired generation a model reservation", async () => {
    const { failed, host } = await failedHost();
    await recover(host, 1);
    await waitForTurn(server.url, host.cookie, (await current(host.hostAccountId)).session_id);
    // Even if the old session's index row still named an input.
    await db`update app.agent_sessions set current_input_id = ${randomUUID()} where session_id = ${failed.session_id}`;

    const provider = new MockLanguageModelV4({ modelId: "gpt-5.6-terra", provider: "openai.responses" });
    await expect(
      limitModel(provider, () => ({ db })).doGenerate({
        prompt: [{ content: [{ text: "Book it.", type: "text" }], role: "user" }],
        providerOptions: { openai: { promptCacheKey: sessionIdHash(failed.session_id) } },
      }),
    ).rejects.toMatchObject({ code: "unattributed" });
    expect(provider.doGenerateCalls).toHaveLength(0);
  });

  it("says when recovery delivered nothing, and following the idle successor ends", async () => {
    const { host, inputId } = await failedHost();
    // Nothing is left to continue: the failed turn's input counts as finished.
    await db`update app.conversation_inputs set state = 'completed' where id = ${inputId}`;

    expect((await recover(host, 1)).body).toEqual({ delivered: false, generation: 2, status: "recovered" });

    const cursor = (await history(host)).length;
    const started = Date.now();
    const response = await routes({ followIdleMs: 500 }).events(
      new Request(`http://localhost:3000/api/chat/events?cursor=${cursor}&follow=1`, { headers: { cookie: host.cookie } }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("continues only the input that never finished, whatever the clocks say", async () => {
    const host = await signInHost(db);
    fake.script.push({ delayMs: 1_000, kind: "text", text: "Noted." });
    const first = await say(host, "Mornings work best.");
    // The database clock runs an hour ahead of the runtime's.
    await db`update app.conversation_inputs set sent_at = now() + interval '1 hour' where id = ${first.body.inputId}`;
    const session = await current(host.hostAccountId);
    await waitForTurn(server.url, host.cookie, session.session_id);
    await eventually(async () => (await inputState(first.body.inputId)) === "completed");
    const charged = await reservationsFor(first.body.inputId);

    fake.script.push({ code: "invalid_api_key", kind: "error", status: 401 });
    const second = await say(host, "And Tuesdays.");
    await eventually(async () => (await current(host.hostAccountId)).state === "failed");
    expect((await recover(host, 1)).body).toMatchObject({ generation: 2, status: "recovered" });

    const successor = await current(host.hostAccountId);
    expect(successor.current_input_id).toBe(second.body.inputId);
    await waitForTurn(server.url, host.cookie, successor.session_id);
    const received = (await readEvents(server.url, host.cookie, successor.session_id)).filter(
      (event) => event.type === "message.received",
    );
    expect(received.map((event) => event.data.message)).toEqual(["And Tuesdays."]);
    expect(await reservationsFor(first.body.inputId)).toBe(charged);
    expect(await inputState(second.body.inputId)).toBe("completed");
  });

  it("sends again an input the failed generation received whose redelivery never arrived", async () => {
    const { host, inputId } = await failedHost();
    // Recovery's send to the successor is lost before it reaches the agent.
    const lost: ConversationRuntime = {
      ...runtime,
      async sendMessage() {
        throw new TypeError("fetch failed: connect timeout");
      },
    };
    expect((await recover(host, 1, { runtime: lost })).body).toMatchObject({ generation: 2, status: "recovered" });
    expect(await inputState(inputId)).toBe("sent");
    // Long after its bearer expired, the successor has not reported receiving it.
    await db`update app.conversation_inputs set sent_at = sent_at - interval '10 minutes' where id = ${inputId}`;

    const later = await say(host, "Also, Fridays are out.");
    expect(later.status).toBe(202);
    await eventually(async () => (await inputState(later.body.inputId)) === "completed");
    expect(await inputState(inputId)).toBe("completed");
    const received = (await readEvents(server.url, host.cookie, (await current(host.hostAccountId)).session_id)).filter(
      (event) => event.type === "message.received",
    );
    expect(received.map((event) => event.data.message)).toEqual(["Find me a time next week.", "Also, Fridays are out."]);
  });

  it("continues input accepted after the failure with its original identity", async () => {
    const { host, inputId } = await failedHost();
    const later = await say(host, "Also, Fridays are out.");
    expect(later).toMatchObject({ body: { status: "recovery_required" }, status: 409 });

    await recover(host, 1);
    const successor = await current(host.hostAccountId);
    await eventually(async () => (await current(host.hostAccountId)).current_input_id === later.body.inputId);
    await waitForTurn(server.url, host.cookie, successor.session_id);
    expect(await reservationsFor(later.body.inputId)).toBeGreaterThanOrEqual(1);
    expect(await reservationsFor(inputId)).toBeGreaterThanOrEqual(1);
  });
});

describe("history and cursors", () => {
  it("shows a re-sent input once even before its new receipt is recorded", async () => {
    const { failed, host } = await failedHost();
    // The successor's receipt for the re-sent input commits 1.5 seconds late.
    const name = `slow_receipt_${host.hostAccountId.replaceAll("-", "_")}`;
    await db.unsafe(`
      create function public.${name}() returns trigger language plpgsql as $$
      begin
        if new.delivery_ids is distinct from old.delivery_ids
           and exists (select 1 from app.discussions d where d.id = new.discussion_id and d.principal_id = '${host.hostAccountId}') then
          perform pg_sleep(1.5);
        end if;
        return new;
      end $$
    `);
    await db.unsafe(`create trigger ${name} before update on app.conversation_inputs for each row execute function public.${name}()`);

    try {
      await recover(host, 1);
      const successor = await current(host.hostAccountId);
      expect(successor.session_id).not.toBe(failed.session_id);
      await eventually(async () =>
        (await readEvents(server.url, host.cookie, successor.session_id)).some((event) => event.type === "message.received"),
      );

      const users = texts(await history(host)).filter((text) => text.startsWith("user:"));
      expect(users).toEqual(["user:Find me a time next week."]);
    } finally {
      await db.unsafe(`drop trigger ${name} on app.conversation_inputs`);
      await db.unsafe(`drop function public.${name}()`);
    }
  });

  it("reads history in order across a recovered conversation, from any cursor", async () => {
    const { host } = await failedHost();
    const beforeRecovery = await history(host);
    await recover(host, 1);
    await waitForTurn(server.url, host.cookie, (await current(host.hostAccountId)).session_id);
    await say(host, "Thanks.");
    await waitForTurn(server.url, host.cookie, (await current(host.hostAccountId)).session_id);

    const all = await settledHistory(host);
    // The retired generation's events come first, unchanged and in order.
    expect(all.slice(0, beforeRecovery.length).map((event) => event.meta.id)).toEqual(
      beforeRecovery.map((event) => event.meta.id),
    );
    expect(new Set(all.map((event) => event.meta.id)).size).toBe(all.length);
    expect(all.filter((event) => (event.type as string) === "app.input.redelivered")).toHaveLength(1);
    // The input recovery sent again shows once; its repeat is a marker that keeps the cursor aligned.
    expect(texts(all)).toEqual([
      "user:Find me a time next week.",
      "assistant:Hello from Thyme.",
      "user:Thanks.",
      "assistant:Hello from Thyme.",
    ]);

    // Reconnecting with an old cursor (inside the retired generation, at its end,
    // and inside the current one) continues exactly where it left off.
    for (const cursor of [2, beforeRecovery.length, beforeRecovery.length + 3, all.length]) {
      expect((await history(host, cursor)).map((event) => event.meta.id)).toEqual(
        all.slice(cursor).map((event) => event.meta.id),
      );
    }
  });

  it("serves no history to another host", async () => {
    const { host } = await failedHost();
    await recover(host, 1);
    const other = await signInHost(db);

    expect(await history(other)).toEqual([]);
    expect(await history(host)).not.toEqual([]);
  });
});

async function recoverDiscussionWithTimeout(host: Host, slow: ConversationRuntime) {
  const { recoverDiscussion } = await import("../../lib/server/recovery");
  return recoverDiscussion({ db, runtime: slow, signingKey: server.signingKey }, host.userId, host.cookie, 1, {
    inspectTimeoutMs: 300,
  });
}
