import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChatRouteDependencies, createEventsHandler, createMessageHandler, createStateHandler } from "../../lib/server/chat-routes";
import { acceptHostMessage, eveRuntime } from "../../lib/server/conversations";
import {
  authorizeHostReviewTool,
  HostReviewToolDeniedError,
  proposeSharedChangesForTool,
  readRequestForHostTool,
} from "../../lib/server/host-review-tools";
import { SetupToolDeniedError } from "../../lib/server/setup-tools";
import { sessionIdHash } from "../../lib/server/model-limits";
import { localAuthConfig, signInHost } from "./support/auth";
import { clearServiceWindow, testDatabase } from "./support/database";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";
import { createTestRequest } from "./support/requests";

// Account session registry, ref projection and generation fences against a
// real local eve service and model stand-in. No host request chat is mounted
// on the website; old per-request production audiences are rejected.

const isApplicationTool = (name: string) => !name.includes("__");
const ACCOUNT_TOOLS = ["agree_to_sent_proposal", "allow_host_trip", "apply_sent_review", "ask_guest", "cancel_sent_booking", "change_booking", "change_sent_agreement", "change_sent_booking", "change_settings", "check_sent_booking", "choose_note_items", "choose_request_tutorial", "choose_sent_time", "confirm_note_items", "confirm_settings", "decide_requests", "disconnect_google_calendar", "dismiss_changes", "draft_sent_request", "draft_settings", "evaluate_candidates", "find_sent_times", "finish_sample_tutorial", "get_sent_request", "list_host_requests", "preview_next_week", "propose_shared_changes", "read_booking_status", "read_request", "read_schedule", "read_settings", "read_setup_state", "resend_sent_booking_link", "save_assistant_notes", "send_schedule_image", "set_calendar_roles", "set_request_intake", "share_changes", "start_request", "use_sent_host_calendars", "waive_weekly_limit", "withdraw_sent_request"];

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

// The host's setup discussion, through the web route.
function message(cookie: string, text: string, request?: string) {
  return createMessageHandler(() => deps)(
    new Request("http://localhost:3000/api/chat/messages", {
      body: JSON.stringify({ clientInputId: randomUUID(), message: text, ...(request ? { request } : {}) }),
      headers: { "content-type": "application/json", cookie, origin: "http://localhost:3000" },
      method: "POST",
    }),
  );
}

// A request discussion, as a linked messenger's receipt delivers a host message.
function review(userId: string, text: string, requestId: string) {
  return acceptHostMessage(deps, userId, { clientInputId: randomUUID(), message: `${text} (request ${requestId})` });
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

describe("the account assistant discussion", () => {
  it("opens one account discussion with host and sent-request tools", async () => {
    const host = await signInHost(db);
    const request = await createTestRequest(db, { hostAccountId: host.hostAccountId });

    await review(host.userId, "What does this request say?", request.requestId);

    const discussion = await discussionOf(host.hostAccountId, null);
    expect(discussion).toMatchObject({ audience: "host_setup" });
    await settled(discussion!.id);

    expect(toolNames(discussion!.session_id!)).toEqual(ACCOUNT_TOOLS);

    // A second message goes to the same discussion.
    await review(host.userId, "What times work?", request.requestId);
    const [count] = await db<{ count: number }[]>`
      select count(*)::int as count from app.discussions where principal_id = ${host.hostAccountId} and audience = 'host_review'
    `;
    expect(count!.count).toBe(0);

    // Setup and requests share one account discussion and tool set.
    const setup = await message(host.cookie, "Hello");
    expect(setup.status).toBe(202);
    const setupDiscussion = await discussionOf(host.hostAccountId, null);
    expect(setupDiscussion?.audience).toBe("host_setup");
    await settled(setupDiscussion!.id);
    expect(setupDiscussion!.id).toBe(discussion!.id);
    expect(toolNames(setupDiscussion!.session_id!)).toEqual(ACCOUNT_TOOLS);
  });

  it("answers another host's request, a draft and an unknown one alike, and opens none from the web", async () => {
    const [host, other] = await Promise.all([signInHost(db), signInHost(db)]);
    const own = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    const foreign = await createTestRequest(db, { hostAccountId: other.hostAccountId });


    // The web routes refuse a request scope, even for the host's own request.
    const sent = await message(host.cookie, "Approve it and book it.", own.requestId);
    expect(sent.status).toBe(400);
    expect(await sent.json()).toMatchObject({ code: "request_scope_unsupported" });
    const state = await createStateHandler(() => deps)(
      new Request(`http://localhost:3000/api/chat/state?request=${own.requestId}`, { headers: { cookie: host.cookie } }),
    );
    expect(state.status).toBe(400);
    const events = await createEventsHandler(() => deps)(
      new Request(`http://localhost:3000/api/chat/events?request=${own.requestId}`, { headers: { cookie: host.cookie } }),
    );
    expect(events.status).toBe(400);
    for (const id of [own.requestId, foreign.requestId]) expect(await discussionOf(host.hostAccountId, id)).toBeNull();
    // Nothing reached the setup discussion either.
    expect(await discussionOf(host.hostAccountId, null)).toBeNull();
  });

  it("fences the tools to the session's own request and live generation", async () => {
    const host = await signInHost(db);
    const request = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await review(host.userId, "Hello", request.requestId);
    const discussion = await discussionOf(host.hostAccountId, null);
    await settled(discussion!.id);
    const auth = {
      attributes: { audience: "host_setup", discussionId: discussion!.id, generation: "1", requestId: request.requestId },
      principalId: host.hostAccountId,
      principalType: "user",
    };
    const call = { auth, requestId: request.requestId, callId: randomUUID(), sessionId: discussion!.session_id! };

    await expect(authorizeHostReviewTool(db, call)).resolves.toMatchObject({ requestId: request.requestId });

    const projection = await readRequestForHostTool(db, call);
    expect(projection.requester).toMatchObject({ email: "present" });
    expect(JSON.stringify(projection)).not.toContain(request.contactEmail);
    expect(JSON.stringify(projection)).not.toContain(request.bookingId);

    const otherRequest = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await expect(authorizeHostReviewTool(db, { ...call, requestId: otherRequest.requestId })).resolves.toMatchObject({ requestId: otherRequest.requestId });
    const outsider = await signInHost(db);
    const foreign = await createTestRequest(db, { hostAccountId: outsider.hostAccountId });
    const draft = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await db`update app.requests set state = 'draft', requester_name = null, contact_email = null where id = ${draft.requestId}`;
    for (const target of [foreign.requestId, draft.requestId, randomUUID()]) {
      await expect(authorizeHostReviewTool(db, { ...call, requestId: target })).rejects.toBeInstanceOf(HostReviewToolDeniedError);
    }
    await expect(authorizeHostReviewTool(db, { ...call, auth: { ...auth, attributes: { ...auth.attributes, audience: "host_review" } } })).rejects.toBeInstanceOf(HostReviewToolDeniedError);

    // A suggestion is recorded for the card, and nothing is shared.
    const suggested = await proposeSharedChangesForTool(db, call, { changes: { durationMinutes: 45 } });
    expect(suggested.recorded).toBe(true);
    const [suggestion] = await db<{ source: string; state: string }[]>`
      select source, state from app.shared_change_drafts where request_id = ${request.requestId}
    `;
    expect(suggestion).toEqual({ source: "assistant", state: "pending" });

    await db`update app.agent_sessions set state = 'retired' where session_id = ${discussion!.session_id}`;
    await expect(authorizeHostReviewTool(db, call)).rejects.toBeInstanceOf(SetupToolDeniedError);
  });
});
