import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChatRouteDependencies, createEventsHandler, createMessageHandler, createStateHandler } from "../../lib/server/chat-routes";
import { eveRuntime } from "../../lib/server/conversations";
import {
  authorizeHostReviewTool,
  HostReviewToolDeniedError,
  proposeSharedChangesForTool,
  readRequestForHostTool,
} from "../../lib/server/host-review-tools";
import { sessionIdHash } from "../../lib/server/model-limits";
import { localAuthConfig, signInHost } from "./support/auth";
import { clearServiceWindow, testDatabase } from "./support/database";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";
import { createTestRequest } from "./support/requests";

// The host's private review discussion of one request (task 3.1 and 3.2; design
// 2 and 12) against a real `eve dev` agent whose model is a local Responses API
// stand-in: the message route's `request` scope, one discussion per host and
// request, the host-review tool set and no other, the fence, and the setup
// discussion left as it was.

const isApplicationTool = (name: string) => !name.includes("__");
const HOST_REVIEW_TOOLS = ["evaluate_candidates", "list_host_requests", "propose_shared_changes", "read_booking_status", "read_request"];

const db = testDatabase();
let fake: FakeOpenAI;
let server: EveServer;
let deps: ChatRouteDependencies;

beforeAll(async () => {
  fake = await startFakeOpenAI();
  await clearServiceWindow(db);
  server = await startEve("dev", { modelBaseURL: fake.baseURL });
  deps = { appOrigin: "http://localhost:3000", auth: localAuthConfig(), db, runtime: eveRuntime(server.url), signingKey: server.signingKey };
}, 300_000);

afterAll(async () => {
  await server?.stop();
  await fake?.close();
  await db.end();
});

function message(cookie: string, text: string, request?: string) {
  return createMessageHandler(() => deps)(
    new Request("http://localhost:3000/api/chat/messages", {
      body: JSON.stringify({ clientInputId: randomUUID(), message: text, ...(request ? { request } : {}) }),
      headers: { "content-type": "application/json", cookie, origin: "http://localhost:3000" },
      method: "POST",
    }),
  );
}

async function discussionOf(hostAccountId: string, requestId: string | null) {
  const [row] = await db<{ audience: string; id: string; session_id: string | null }[]>`
    select d.id, d.audience,
           (select session_id from app.agent_sessions s where s.discussion_id = d.id order by generation desc limit 1) as session_id
    from app.discussions d
    where d.principal_type = 'host_account' and d.principal_id = ${hostAccountId} and d.request_id is not distinct from ${requestId}
  `;
  return row ?? null;
}

async function settled(discussionId: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const [row] = await db<{ pending: number }[]>`
      select count(*)::int as pending from app.conversation_inputs where discussion_id = ${discussionId} and state <> 'completed'
    `;
    if (row!.pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
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

describe("the host review discussion", () => {
  it("opens one private discussion per request with only the host-review tools", async () => {
    const host = await signInHost(db);
    const request = await createTestRequest(db, { hostAccountId: host.hostAccountId });

    const sent = await message(host.cookie, "Approve it and book it.", request.requestId);
    expect(sent.status).toBe(202);

    const review = await discussionOf(host.hostAccountId, request.requestId);
    expect(review).toMatchObject({ audience: "host_review" });
    await settled(review!.id);

    expect(toolNames(review!.session_id!)).toEqual(HOST_REVIEW_TOOLS);
    // "approve it" is only text: nothing is approved or booked.
    const [approvals] = await db<{ count: number }[]>`select count(*)::int as count from app.approvals where request_id = ${request.requestId}`;
    expect(approvals!.count).toBe(0);

    // A second message goes to the same discussion.
    await message(host.cookie, "What times work?", request.requestId);
    const [count] = await db<{ count: number }[]>`
      select count(*)::int as count from app.discussions where principal_id = ${host.hostAccountId} and audience = 'host_review'
    `;
    expect(count!.count).toBe(1);

    // Setup is its own discussion, with its own tools.
    const setup = await message(host.cookie, "Hello");
    expect(setup.status).toBe(202);
    const setupDiscussion = await discussionOf(host.hostAccountId, null);
    expect(setupDiscussion?.audience).toBe("host_setup");
    await settled(setupDiscussion!.id);
    expect(toolNames(setupDiscussion!.session_id!)).not.toContain("read_request");
  });

  it("answers another host's request, a draft and a malformed scope like an unknown one", async () => {
    const [host, other] = await Promise.all([signInHost(db), signInHost(db)]);
    const foreign = await createTestRequest(db, { hostAccountId: other.hostAccountId });
    const draft = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await db`update app.requests set state = 'draft', requester_name = null, contact_email = null where id = ${draft.requestId}`;

    for (const id of [foreign.requestId, draft.requestId, randomUUID()]) {
      const response = await message(host.cookie, "Hi", id);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "request_unavailable" });
    }

    const state = await createStateHandler(() => deps)(
      new Request("http://localhost:3000/api/chat/state?request=not-a-uuid", { headers: { cookie: host.cookie } }),
    );
    expect(state.status).toBe(404);
    const events = await createEventsHandler(() => deps)(
      new Request(`http://localhost:3000/api/chat/events?request=${foreign.requestId}`, { headers: { cookie: host.cookie } }),
    );
    expect(events.status).toBe(404);
    expect(await discussionOf(host.hostAccountId, foreign.requestId)).toBeNull();
  });

  it("fences the tools to the session's own request and live generation", async () => {
    const host = await signInHost(db);
    const request = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await message(host.cookie, "Hello", request.requestId);
    const review = await discussionOf(host.hostAccountId, request.requestId);
    await settled(review!.id);
    const auth = {
      attributes: { audience: "host_review", discussionId: review!.id, generation: "1", requestId: request.requestId },
      principalId: host.hostAccountId,
      principalType: "user",
    };
    const call = { auth, callId: randomUUID(), sessionId: review!.session_id! };

    await expect(authorizeHostReviewTool(db, call)).resolves.toMatchObject({ requestId: request.requestId });

    const projection = await readRequestForHostTool(db, call);
    expect(projection.requester).toMatchObject({ email: "present" });
    expect(JSON.stringify(projection)).not.toContain(request.contactEmail);
    expect(JSON.stringify(projection)).not.toContain(request.bookingId);

    const otherRequest = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await expect(
      authorizeHostReviewTool(db, { ...call, auth: { ...auth, attributes: { ...auth.attributes, requestId: otherRequest.requestId } } }),
    ).rejects.toBeInstanceOf(HostReviewToolDeniedError);
    await expect(
      authorizeHostReviewTool(db, { ...call, auth: { ...auth, attributes: { ...auth.attributes, audience: "host_setup" } } }),
    ).rejects.toBeInstanceOf(HostReviewToolDeniedError);

    // A suggestion is recorded for the card, and nothing is shared.
    const suggested = await proposeSharedChangesForTool(db, call, { changes: { durationMinutes: 45 } });
    expect(suggested.recorded).toBe(true);
    const [suggestion] = await db<{ source: string; state: string }[]>`
      select source, state from app.shared_change_drafts where request_id = ${request.requestId}
    `;
    expect(suggestion).toEqual({ source: "assistant", state: "pending" });

    await db`update app.agent_sessions set state = 'retired' where session_id = ${review!.session_id}`;
    await expect(authorizeHostReviewTool(db, call)).rejects.toBeInstanceOf(HostReviewToolDeniedError);
  });
});
