import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChatRouteDependencies, createMessageHandler } from "../../lib/server/chat-routes";
import { eveRuntime, openSetupSession } from "../../lib/server/conversations";
import { MODEL_LIMITS, sessionIdHash } from "../../lib/server/model-limits";
import { localAuthConfig, signInHost } from "./support/auth";
import { clearServiceWindow, testDatabase } from "./support/database";
import { readEvents, waitForTurn } from "./support/eve-calls";
import { buildEve, type EveServer, eveEnvironment, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";

// The application message route and session index (task 4.4), against a real
// `eve dev` agent service whose model is a local Responses API stand-in.

const db = testDatabase();
let fake: FakeOpenAI;
let server: EveServer;
let deps: ChatRouteDependencies;
let post: ReturnType<typeof createMessageHandler>;

beforeAll(async () => {
  fake = await startFakeOpenAI();
  await clearServiceWindow(db);
  server = await startEve("dev", { modelBaseURL: fake.baseURL });
  deps = { appOrigin: "http://localhost:3000", auth: localAuthConfig(), db, runtime: eveRuntime(server.url), signingKey: server.signingKey };
  post = createMessageHandler(() => deps);
}, 300_000);

afterAll(async () => {
  await server?.stop();
  await fake.close();
  await db.end();
});

function message(cookie: string, text: string, clientInputId = randomUUID()) {
  return post(
    new Request("http://localhost:3000/api/chat/messages", {
      body: JSON.stringify({ clientInputId, message: text }),
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
      method: "POST",
    }),
  );
}

async function sessionOf(hostAccountId: string) {
  const [row] = await db<{ session_id: string; current_input_id: string; generation: number }[]>`
    select s.session_id, s.current_input_id, s.generation
    from app.agent_sessions s join app.discussions d on d.id = s.discussion_id
    where d.principal_id = ${hostAccountId} and s.state = 'active'
  `;
  return row!;
}

async function reservationsFor(workId: string) {
  return db<{ session_id: string }[]>`select session_id from app.model_reservations where work_id = ${workId}`;
}

async function inputState(inputId: string) {
  const [row] = await db<{ state: string }[]>`select state from app.conversation_inputs where id = ${inputId}`;
  return row?.state;
}

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 40 && !(await check()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe("message route and session index", () => {
  it("creates the session on first use and attributes the turn's model call to the accepted input", async () => {
    const host = await signInHost(db);
    const response = await message(host.cookie, "Find me a time next week.");

    expect(response.status).toBe(202);
    const { inputId, status } = (await response.json()) as { inputId: string; status: string };
    expect(status).toBe("sent");

    const session = await sessionOf(host.hostAccountId);
    expect(session).toMatchObject({ current_input_id: inputId, generation: 1 });
    const turn = await waitForTurn(server.url, host.cookie, session.session_id);
    expect(turn.at(-1)?.type).toBe("session.waiting");

    const reserved = await reservationsFor(inputId);
    const sent = fake.requests.filter((request) => request.prompt_cache_key === sessionIdHash(session.session_id));
    expect(reserved.length).toBe(sent.length);
    expect(reserved.every((row) => row.session_id === session.session_id)).toBe(true);
    await waitFor(async () => (await inputState(inputId)) === "completed");
    expect(await inputState(inputId)).toBe("completed");
  });

  it("returns an exact retry's receipt without sending again, and rejects a changed retry", async () => {
    const host = await signInHost(db);
    const clientInputId = randomUUID();
    const first = (await (await message(host.cookie, "Mornings work best.", clientInputId)).json()) as { inputId: string };
    const session = await sessionOf(host.hostAccountId);
    await waitForTurn(server.url, host.cookie, session.session_id);
    const events = (await readEvents(server.url, host.cookie, session.session_id)).length;
    const requests = fake.requests.length;

    const retry = await message(host.cookie, "Mornings work best.", clientInputId);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ inputId: first.inputId, status: "sent" });

    const changed = await message(host.cookie, "Evenings work best.", clientInputId);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "retry_conflict" });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fake.requests.length).toBe(requests);
    expect(await readEvents(server.url, host.cookie, session.session_id)).toHaveLength(events);
  });

  it("keeps one host out of another host's session", async () => {
    const [hostA, hostB] = await Promise.all([signInHost(db), signInHost(db)]);
    await message(hostA.cookie, "Only for host A.");
    const sessionA = await sessionOf(hostA.hostAccountId);
    await waitForTurn(server.url, hostA.cookie, sessionA.session_id);
    const eventsA = (await readEvents(server.url, hostA.cookie, sessionA.session_id)).length;

    // Host B can neither read nor stream host A's session...
    const streamed = await fetch(`${server.url}/eve/v1/session/${sessionA.session_id}/stream`, {
      headers: { cookie: hostB.cookie },
    });
    expect(streamed.status).toBe(403);
    // ...nor continue it: B's message goes to B's own discussion and session.
    const sentB = await message(hostB.cookie, "Continue host A's conversation.");
    expect(sentB.status).toBe(202);
    const sessionB = await sessionOf(hostB.hostAccountId);
    expect(sessionB.session_id).not.toBe(sessionA.session_id);
    await waitForTurn(server.url, hostB.cookie, sessionB.session_id);

    expect(await readEvents(server.url, hostA.cookie, sessionA.session_id)).toHaveLength(eventsA);
  });

  it("refuses an unauthenticated caller and a suspended host without recording input", async () => {
    expect((await message("", "Hello")).status).toBe(401);

    const host = await signInHost(db);
    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;
    const response = await message(host.cookie, "Hello");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ nextAction: "account_suspended" });
    const [count] = await db<{ count: number }[]>`
      select count(*)::int as count from app.discussions where principal_id = ${host.hostAccountId}
    `;
    expect(count!.count).toBe(0);
  });

  it("opens one authorized empty setup session on the visit, which the first message then uses", async () => {
    const host = await signInHost(db);
    const actor = { id: host.hostAccountId, kind: "host_account" as const };
    const opened = await openSetupSession(deps, host.userId, actor);

    expect(opened).toMatchObject({ current_input_id: null, generation: 1, state: "active" });
    // A repeat visit replays the command and creates no second session.
    expect(await openSetupSession(deps, host.userId, actor)).toEqual(opened);
    expect(await readEvents(server.url, host.cookie, opened!.session_id)).toBeDefined();
    const [reserved] = await db<{ count: number }[]>`
      select count(*)::int as count from app.model_reservations where session_id = ${opened!.session_id}
    `;
    expect(reserved!.count).toBe(0);

    const response = await message(host.cookie, "Hello, Thyme.");
    const { inputId } = (await response.json()) as { inputId: string };
    expect(await sessionOf(host.hostAccountId)).toMatchObject({ current_input_id: inputId, session_id: opened!.session_id });
    await waitForTurn(server.url, host.cookie, opened!.session_id);
    expect((await reservationsFor(inputId)).length).toBeGreaterThan(0);
  });

  it("opens no setup session for a suspended host or a mismatched actor", async () => {
    const host = await signInHost(db);
    const other = await signInHost(db);

    expect(await openSetupSession(deps, host.userId, { id: other.hostAccountId, kind: "host_account" })).toBeNull();
    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;
    expect(await openSetupSession(deps, host.userId, { id: host.hostAccountId, kind: "host_account" })).toBeNull();
    const [count] = await db<{ count: number }[]>`
      select count(*)::int as count from app.discussions where principal_id = ${host.hostAccountId}
    `;
    expect(count!.count).toBe(0);
  });

  it("configures sessions with no lifetime deadline", async () => {
    // The deployment build's manifest; built here so a fresh checkout has one.
    await buildEve(eveEnvironment({ modelBaseURL: fake.baseURL, signingKey: "build-time-placeholder" }));
    const manifest = JSON.parse(
      await readFile(new URL("../../.output/.eve/compile/compiled-agent-manifest.json", import.meta.url), "utf8"),
    ) as { config: { limits?: { sessionTimeoutMs?: unknown } } };

    expect(manifest.config.limits?.sessionTimeoutMs).toBe(false);
  }, 300_000);
});

describe("agent model in the runtime", () => {
  it("reserves every provider call of a turn with a forced retry and a forced compaction", async () => {
    const host = await signInHost(db);

    // Turn 1 reports a large prompt, so eve compacts before turn 2's model step;
    // turn 2's first provider attempt fails and is retried.
    fake.script.push({ inputTokens: 25_000, kind: "text", text: "Noted." });
    const first = (await (await message(host.cookie, "I prefer mornings.")).json()) as { inputId: string };
    const session = await sessionOf(host.hostAccountId);
    await waitForTurn(server.url, host.cookie, session.session_id);
    const before = fake.requests.length;
    const index = (await readEvents(server.url, host.cookie, session.session_id)).length;

    fake.script.push({ kind: "error", status: 500 });
    const second = (await (await message(host.cookie, "And Tuesdays.")).json()) as { inputId: string };
    const turn = await waitForTurn(server.url, host.cookie, session.session_id, index);
    const types = turn.map((event) => event.type);

    expect(types).toContain("compaction.completed");
    expect(types.at(-1)).toBe("session.waiting");
    const during = fake.requests.slice(before);
    // The compaction call, the failed attempt and its retry, at least.
    expect(during.length).toBeGreaterThanOrEqual(3);
    expect(during.every((request) => request.prompt_cache_key === sessionIdHash(session.session_id))).toBe(true);
    expect(during.every((request) => request.store === false && request.service_tier === "default")).toBe(true);
    expect(fake.bodyBytes.slice(before).every((bytes) => bytes < MODEL_LIMITS.maxInputBytes)).toBe(true);
    expect(await reservationsFor(second.inputId)).toHaveLength(during.length);
    expect((await reservationsFor(first.inputId)).length).toBeGreaterThanOrEqual(1);
  });
});
