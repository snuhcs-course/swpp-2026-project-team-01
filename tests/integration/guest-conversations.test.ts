import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eveRuntime } from "../../lib/server/conversations";
import { acceptGuestMessage } from "../../lib/server/guest-conversations";
import { signInternalBearer } from "../../lib/server/internal-bearer";
import { sessionIdHash } from "../../lib/server/model-limits";
import {
  createIntakeTranscriptHandler,
  createRequesterCommandHandler,
  createRequesterEventsHandler,
  createRequesterMessageHandler,
  type RequesterRouteDependencies,
} from "../../lib/server/requester-routes";
import { clearServiceWindow, testDatabase } from "./support/database";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";
import { call, guestDependencies, readyHost, startDraft } from "./support/guests";
import { uniqueEmail } from "./support/requests";

// Framework tools eve registers itself (task control, and dev-only self
// modification) are named with "__"; the application's tools never are.
const isApplicationTool = (name: string) => !name.includes("__");

// The guest conversation against a real `eve dev` agent whose model is a local
// Responses API stand-in (tasks 3.2 and 9.1): the first message on the public
// page starts a draft whose session registers only the requester tools,
// identification keeps the same session with the earlier messages as context,
// history and the live stream come through the application's routes with an
// internal read bearer, a requester principal reaches no other request's
// session, and nothing a guest's browser holds lets it call /eve/v1.

const db = testDatabase();
let fake: FakeOpenAI;
let server: EveServer;
let deps: RequesterRouteDependencies;

const HOST_TOOLS = ["read_setup_state", "draft_settings"];
// The retired public intake's tools, registered for no session any more.
const INTAKE_TOOLS = ["read_intake", "draft_intake"];
const REQUESTER_TOOLS = ["read_request", "draft_request_review", "ask_for_identity", "evaluate_candidates", "read_booking_status"];

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

async function sessionsOf(discussionId: string) {
  return db<{ generation: number; session_id: string }[]>`
    select session_id, generation from app.agent_sessions where discussion_id = ${discussionId} order by generation
  `;
}

// A guest's thread: the first message on the public page starts the draft, and
// Continue without Google identifies it.
async function guestThread() {
  const host = await readyHost(db);
  const sent = await startDraft(deps, host.handle, "What is the host's calendar next week?");
  expect(sent.status).toBe(202);
  const { bookingId } = (await sent.json()) as { bookingId: string };
  const [request] = await db<{ discussion_id: string; id: string; state: string }[]>`
    select r.id, r.state, d.id as discussion_id from app.requests r
    join app.discussions d on d.principal_type = 'requester_request' and d.principal_id = r.id
    where r.host_account_id = ${host.hostAccountId}
  `;
  expect(request!.state).toBe("draft");
  await completed(request!.discussion_id);
  const [draftSession] = await sessionsOf(request!.discussion_id);

  const identified = await call(createRequesterCommandHandler(() => deps), { bookingId }, "/commands", {
    body: {
      expectedRevision: null,
      input: { email: uniqueEmail(), name: "Grace Hopper", timezone: "Asia/Seoul" },
      operation: "request.identify",
      retryKey: randomUUID(),
    },
  });
  expect(identified.status).toBe(200);

  return { bookingId, request: { ...request!, sessionId: draftSession!.session_id } };
}

describe("guest sessions", () => {
  let first: Awaited<ReturnType<typeof guestThread>>;
  let second: Awaited<ReturnType<typeof guestThread>>;

  beforeAll(async () => {
    first = await guestThread();
    second = await guestThread();
  }, 180_000);

  it("gives the draft's session only the requester tools", () => {
    const requesterTools = toolNames(first.request.sessionId);
    expect(fake.requests.some((entry) => entry.prompt_cache_key === sessionIdHash(first.request.sessionId))).toBe(true);
    expect(requesterTools).toEqual([...REQUESTER_TOOLS].sort());
    for (const tool of [...HOST_TOOLS, ...INTAKE_TOOLS]) expect(requesterTools).not.toContain(tool);
  });

  it("records no agreement, proposal or state change for a message such as yes or book it", async () => {
    const principal = { id: first.request.id, type: "requester_request" } as const;
    const [before] = await db<{ revision: number; state: string }[]>`select state, revision from app.requests where id = ${first.request.id}`;
    // Even a reply that claims a booking changes nothing.
    fake.rules.push({ includes: "book it", reply: { kind: "text", text: "Done, it is booked." } });

    for (const message of ["yes", "book it"]) {
      await acceptGuestMessage(deps, principal, { clientInputId: randomUUID(), message });
      await completed(first.request.discussion_id);
    }

    const [after] = await db<{ revision: number; state: string }[]>`select state, revision from app.requests where id = ${first.request.id}`;
    const [decisions] = await db<{ agreements: number; proposals: number; reviews: number }[]>`
      select (select count(*)::int from app.proposals where request_id = ${first.request.id}) as proposals,
             (select count(*)::int from app.agreements a join app.proposals p on p.id = a.proposal_id where p.request_id = ${first.request.id}) as agreements,
             (select count(*)::int from app.request_reviews where request_id = ${first.request.id} and state = 'applied') as reviews
    `;
    expect(after).toEqual(before);
    expect(decisions).toEqual({ agreements: 0, proposals: 0, reviews: 0 });
  });

  it("keeps the draft's session through identification, with the earlier messages as context", async () => {
    const response = await call(createRequesterMessageHandler(() => deps), { bookingId: first.bookingId }, "/messages", {
      body: { clientInputId: randomUUID(), message: "Thirty minutes online would be great." },
    });
    expect(response.status).toBe(202);
    await completed(first.request.discussion_id);

    // One session served the draft and the identified request: no new
    // generation, and no authored summary input.
    expect(await sessionsOf(first.request.discussion_id)).toEqual([{ generation: 1, session_id: first.request.sessionId }]);
    const inputs = await db<{ message: string }[]>`
      select message from app.conversation_inputs where discussion_id = ${first.request.discussion_id} order by accepted_at
    `;
    expect(inputs.map((input) => input.message)).toEqual([
      "What is the host's calendar next week?",
      "yes",
      "book it",
      "Thirty minutes online would be great.",
    ]);

    // The model's last call for this session still carries the first message.
    const calls = fake.requests.filter((entry) => entry.prompt_cache_key === sessionIdHash(first.request.sessionId));
    expect(JSON.stringify(calls.at(-1)?.input)).toContain("What is the host's calendar next week?");

    const events = await call(createRequesterEventsHandler(() => deps), { bookingId: first.bookingId }, "/events?cursor=0");
    expect(events.status).toBe(200);
    expect(events.headers.get("referrer-policy")).toBe("no-referrer");
    expect(events.headers.get("x-robots-tag")).toBe("noindex");
    expect(events.headers.get("cache-control")).toContain("no-store");
    const received = (await lines(events)).filter((event) => event.type === "message.received");
    expect(received[0]?.data?.message).toBe("What is the host's calendar next week?");
  });

  it("serves no intake transcript for a request that began as a draft", async () => {
    const response = await call(createIntakeTranscriptHandler(() => deps), { bookingId: first.bookingId }, "/intake?cursor=0");
    expect(await lines(response)).toEqual([]);
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
