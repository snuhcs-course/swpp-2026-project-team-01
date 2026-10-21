import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eveRuntime } from "../../lib/server/conversations";
import { openGuestSession } from "../../lib/server/guest-conversations";
import {
  createIntakeContinueHandler,
  createIntakeMessageHandler,
  type IntakeRouteDependencies,
} from "../../lib/server/intake-routes";
import { hashIntakeToken } from "../../lib/server/intakes";
import { signInternalBearer } from "../../lib/server/internal-bearer";
import { sessionIdHash } from "../../lib/server/model-limits";
import { createIntakeTranscriptHandler, createRequesterEventsHandler } from "../../lib/server/requester-routes";
import { clearServiceWindow, testDatabase } from "./support/database";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";
import { call, guestDependencies, readyHost } from "./support/guests";
import { uniqueEmail } from "./support/requests";

// Framework tools eve registers itself (task control, and dev-only self
// modification) are named with "__"; the application's tools never are.
const isApplicationTool = (name: string) => !name.includes("__");

// The intake and requester conversations against a real `eve dev` agent whose
// model is a local Responses API stand-in (tasks 3.1 and 3.2): each session
// registers only its audience's tools, history and the live stream come through
// the application's routes with an internal read bearer, a requester principal
// reaches no other request's session, and nothing a requester's browser holds
// lets it call /eve/v1.

const db = testDatabase();
let fake: FakeOpenAI;
let server: EveServer;
let deps: IntakeRouteDependencies;

const HOST_TOOLS = ["read_setup_state", "draft_settings"];
const INTAKE_TOOLS = ["read_intake", "draft_intake"];

beforeAll(async () => {
  fake = await startFakeOpenAI();
  await clearServiceWindow(db);
  server = await startEve("dev", { modelBaseURL: fake.baseURL });
  deps = guestDependencies(db, { runtime: eveRuntime(server.url), signingKey: server.signingKey });
}, 300_000);

afterAll(async () => {
  await server?.stop();
  await fake?.close();
  await db.end();
});

async function waitFor(check: () => Promise<boolean>, attempts = 120) {
  for (let attempt = 0; attempt < attempts && !(await check()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function completed(discussionId: string) {
  await waitFor(async () => {
    const [row] = await db<{ pending: number }[]>`
      select count(*)::int as pending from app.conversation_inputs where discussion_id = ${discussionId} and state <> 'completed'
    `;
    return row!.pending === 0;
  });
}

function toolNames(sessionId: string) {
  const names = new Set<string>();
  for (const request of fake.requests.filter((entry) => entry.prompt_cache_key === sessionIdHash(sessionId))) {
    for (const tool of (request.tools as { name?: string }[] | undefined) ?? []) {
      if (tool.name && isApplicationTool(tool.name)) names.add(tool.name);
    }
  }
  return [...names].sort();
}

async function lines(response: Response) {
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; data?: { message?: string } });
}

async function intakeWithRequest() {
  const host = await readyHost(db);
  const sent = await call(createIntakeMessageHandler(() => deps), { handle: host.handle }, `/api/intake/${host.handle}/messages`, {
    body: { clientInputId: randomUUID(), language: "en", message: "What is the host's calendar next week?", timezone: "Asia/Seoul" },
  });
  expect(sent.status).toBe(202);
  const { intakeToken } = (await sent.json()) as { intakeToken: string };
  const [intake] = await db<{ discussion_id: string; id: string }[]>`
    select id, discussion_id from app.intakes where token_hash = ${hashIntakeToken(intakeToken)}
  `;
  await completed(intake!.discussion_id);
  const [intakeSession] = await db<{ session_id: string }[]>`
    select session_id from app.agent_sessions where discussion_id = ${intake!.discussion_id}
  `;

  const continued = await call(createIntakeContinueHandler(() => deps), { handle: host.handle }, `/api/intake/${host.handle}/continue`, {
    body: { email: uniqueEmail(), language: "en", name: "Grace Hopper", timezone: "Asia/Seoul" },
    headers: { "x-intake-token": intakeToken },
  });
  const { bookingId } = (await continued.json()) as { bookingId: string };
  const [request] = await db<{ discussion_id: string; id: string }[]>`
    select r.id, d.id as discussion_id from app.requests r
    join app.discussions d on d.principal_type = 'requester_request' and d.principal_id = r.id
    where r.host_account_id = ${host.hostAccountId}
  `;
  const session = await openGuestSession(deps, { id: request!.id, type: "requester_request" });
  await completed(request!.discussion_id);

  return { bookingId, intake: { ...intake!, sessionId: intakeSession!.session_id }, request: { ...request!, sessionId: session!.session_id } };
}

describe("guest sessions", () => {
  let first: Awaited<ReturnType<typeof intakeWithRequest>>;
  let second: Awaited<ReturnType<typeof intakeWithRequest>>;

  beforeAll(async () => {
    first = await intakeWithRequest();
    second = await intakeWithRequest();
  }, 180_000);

  it("gives an intake session only the intake tools, and a requester session no host or intake tool", () => {
    expect(toolNames(first.intake.sessionId)).toEqual([...INTAKE_TOOLS].sort());

    const requesterTools = toolNames(first.request.sessionId);
    expect(fake.requests.some((entry) => entry.prompt_cache_key === sessionIdHash(first.request.sessionId))).toBe(true);
    for (const tool of [...HOST_TOOLS, ...INTAKE_TOOLS]) expect(requesterTools).not.toContain(tool);
  });

  it("delivers the authored intake summary as the request session's first input", async () => {
    const response = await call(createRequesterEventsHandler(() => deps), { bookingId: first.bookingId }, "/events?cursor=0");
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toContain("no-store");

    const received = (await lines(response)).filter((event) => event.type === "message.received");
    expect(received[0]?.data?.message).toMatch(/^Intake summary from the public page/);
  });

  it("serves the intake transcript read-only from the intake discussion", async () => {
    const response = await call(createIntakeTranscriptHandler(() => deps), { bookingId: first.bookingId }, "/intake?cursor=0");
    const received = (await lines(response)).filter((event) => event.type === "message.received");
    expect(received.map((event) => event.data?.message)).toEqual(["What is the host's calendar next week?"]);
  });

  it("keeps one request's principal out of another request's session", async () => {
    const principal = { id: first.request.id, type: "requester_request" } as const;
    const stream = (bearer?: string) =>
      fetch(`${server.url}/eve/v1/session/${second.request.sessionId}/stream`, {
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      });

    // A's principal naming B's session, with A's or B's discussion.
    for (const discussionId of [first.request.discussion_id, second.request.discussion_id]) {
      const bearer = signInternalBearer(
        { discussionId, generation: 1, kind: "read", principal, sessionId: second.request.sessionId },
        server.signingKey,
      );
      expect((await stream(bearer)).status).toBe(403);
    }

    // Nothing a browser holds reaches /eve/v1: no credential at all, and the
    // booking link itself as a bearer.
    expect((await stream()).status).toBe(401);
    expect((await stream(second.bookingId)).status).toBe(403);
  });

  it("stops serving a request's conversation once it closes", async () => {
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${second.request.id}`;

    const route = await call(createRequesterEventsHandler(() => deps), { bookingId: second.bookingId }, "/events?cursor=0");
    expect(route.status).toBe(404);

    const bearer = signInternalBearer(
      {
        discussionId: second.request.discussion_id,
        generation: 1,
        kind: "read",
        principal: { id: second.request.id, type: "requester_request" },
        sessionId: second.request.sessionId,
      },
      server.signingKey,
    );
    const direct = await fetch(`${server.url}/eve/v1/session/${second.request.sessionId}/stream`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(direct.status).toBe(403);
  });
});
