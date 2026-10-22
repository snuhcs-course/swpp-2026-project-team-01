import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import { isHostVisibleRequestState } from "../../lib/contracts/request";
import { hashBookingId } from "../../lib/server/booking-links";
import { createAppAuth } from "../../lib/server/eve-auth";
import { signInternalBearer } from "../../lib/server/internal-bearer";
import { publishJob } from "../../lib/server/jobs";
import { limitModel, sessionIdHash } from "../../lib/server/model-limits";
import { createRequestExpiryHandler, REQUEST_EXPIRY_JOB } from "../../lib/server/request-lifecycle";
import { CREATION_LIMITS, DRAFT_LIMITS, starterId } from "../../lib/server/request-start";
import {
  askForIdentityForTool,
  draftRequestReviewForTool,
  evaluateCandidatesForTool,
  readRequestForTool,
} from "../../lib/server/request-tools";
import {
  createRequesterCommandHandler,
  createRequesterMessageHandler,
  createRequesterStateHandler,
  type RequesterRouteDependencies,
} from "../../lib/server/requester-routes";
import { localAuthConfig } from "./support/auth";
import { testDatabase } from "./support/database";
import {
  call,
  guestDependencies,
  indexRequestSession,
  readyHost,
  recordingRuntime,
  SIGNING_KEY,
  type Sent,
  sourceAddress,
  startDraft,
  startedDraft,
} from "./support/guests";
import { runJob, testNotices, uniqueEmail } from "./support/requests";
import { MONDAY } from "./support/scheduling";

// One guest thread from the first message (task 9.1; design decision 2, D13):
// request.start with its bounds and retry identity, the draft's message cap,
// invisibility to the host, expiry and deletion, identity_required on each
// gated operation, request.identify keeping the same session and sending the
// creation email, the unconfirmed-request model cap on drafts, and the
// transcript of an intake from before D13 staying readable. A recording runtime
// stands in for eve; the session's tool list is covered against a real agent in
// guest-conversations.

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

function message(deps: RequesterRouteDependencies, bookingId: string, text: string, clientInputId = randomUUID()) {
  return call(createRequesterMessageHandler(() => deps), { bookingId }, "/messages", { body: { clientInputId, message: text } });
}

function command(deps: RequesterRouteDependencies, bookingId: string, operation: string, input: unknown = {}, retryKey = randomUUID()) {
  return call(createRequesterCommandHandler(() => deps), { bookingId }, "/commands", {
    body: { expectedRevision: null, input, operation, retryKey },
  });
}

function identify(deps: RequesterRouteDependencies, bookingId: string, email = uniqueEmail(), retryKey = randomUUID()) {
  return command(deps, bookingId, "request.identify", { email, name: "Grace Hopper", timezone: "Asia/Seoul" }, retryKey);
}

async function requestRow(requestId: string) {
  const [row] = await db<
    {
      contact_email: string | null;
      created_at: Date;
      expires_at: Date;
      identified_at: Date | null;
      identity_requested_at: Date | null;
      requester_name: string | null;
      revision: number;
      state: string;
    }[]
  >`
    select state, revision, requester_name, contact_email, created_at, expires_at, identified_at, identity_requested_at
    from app.requests where id = ${requestId}
  `;
  return row;
}

function requesterCall(requestId: string, sessionId: string) {
  return {
    auth: { attributes: { audience: "requester" }, principalId: `request:${requestId}`, principalType: "user" },
    callId: randomUUID(),
    sessionId,
  };
}

describe("request.start", () => {
  it("starts a draft on the first message with a hashed and sealed link, its discussion and the message as its first input", async () => {
    const host = await readyHost(db);
    const sent: Sent[] = [];
    const deps = guestDependencies(db, { runtime: recordingRuntime(sent) });
    const nonce = randomUUID();

    const response = await startDraft(deps, host.handle, "I'd like to talk about a research collaboration.", { nonce });
    expect(response.status).toBe(202);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { bookingId, status } = (await response.json()) as { bookingId: string; status: string };
    expect(status).toBe("sent");

    const [request] = await db<
      { contact_email: string | null; details: Record<string, unknown>; expires_at: Date; id: string; link_ciphertext: string; requester_name: string | null; state: string }[]
    >`
      select r.id, r.state, r.details, r.requester_name, r.contact_email, r.expires_at, l.link_ciphertext
      from app.requests r join app.booking_links l on l.request_id = r.id
      where l.link_hash = ${hashBookingId(bookingId)} and r.host_account_id = ${host.hostAccountId}
    `;
    expect(request).toMatchObject({ contact_email: null, requester_name: null, state: "draft" });
    expect(request!.details).toMatchObject({ language: "en", timezone: "Asia/Seoul" });
    expect(request!.link_ciphertext).not.toContain(bookingId);
    // A draft lasts 24 hours.
    expect(Math.abs(request!.expires_at.getTime() - Date.now() - DRAFT_LIMITS.lifetimeHours * 3_600_000)).toBeLessThan(60_000);

    const inputs = await db<{ message: string }[]>`
      select i.message from app.conversation_inputs i
      join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${request!.id} and d.audience = 'requester'
    `;
    expect(inputs.map((input) => input.message)).toEqual(["I'd like to talk about a research collaboration."]);
    expect(sent.map((entry) => entry.message)).toEqual(["I'd like to talk about a research collaboration."]);

    // The saved outcome holds no booking link; the actor is the nonce's hash.
    const [outcome] = await db<{ result: unknown }[]>`
      select result from app.command_outcomes where actor = ${`guest_starter:${starterId(nonce)}`}
    `;
    expect(JSON.stringify(outcome!.result)).not.toContain(bookingId);
    expect(JSON.stringify(outcome)).not.toContain(nonce);

    // The tab continues the same draft through the booking identifier.
    expect((await message(deps, bookingId, "Thirty minutes, online.")).status).toBe(202);
    const state = await call(createRequesterStateHandler(() => deps), { bookingId }, "/state");
    expect(await state.json()).toMatchObject({ contact: null, open: true, request: { state: "draft" }, thread: [] });
  });

  it("creates one draft for a retried first message and charges its bound once", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const nonce = randomUUID();
    const clientInputId = randomUUID();
    const send = () => startDraft(deps, host.handle, "Hello", { clientInputId, nonce });

    const [first, second] = await Promise.all([send(), send()]);
    const answers = await Promise.all([first.json(), second.json()]);
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(answers[0].bookingId).toBe(answers[1].bookingId);
    expect(answers[0].inputId).toBe(answers[1].inputId);

    // A later retry after the response was lost answers the same draft too.
    const third = await send();
    expect(((await third.json()) as { bookingId: string }).bookingId).toBe(answers[0].bookingId);

    const [counts] = await db<{ creations: number; inputs: number; requests: number }[]>`
      select (select count(*)::int from app.requests where host_account_id = ${host.hostAccountId}) as requests,
             (select count(*)::int from app.request_creations where host_account_id = ${host.hostAccountId}) as creations,
             (select count(*)::int from app.conversation_inputs i join app.discussions d on d.id = i.discussion_id
               join app.requests r on r.id = d.principal_id where r.host_account_id = ${host.hostAccountId}) as inputs
    `;
    expect(counts).toEqual({ creations: 1, inputs: 1, requests: 1 });
  });

  it("bounds drafts to 5 per source an hour, 20 a day and 500 across the service a day", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db, { creationLimits: { serviceDay: Number.POSITIVE_INFINITY } });
    const source = sourceAddress();

    for (let index = 0; index < CREATION_LIMITS.perSourceHour; index += 1) {
      expect((await startDraft(deps, host.handle, "Hello", { source })).status).toBe(202);
    }

    const sixth = await startDraft(deps, host.handle, "Hello", { source });
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ code: "rate_limited", error: "Too many new conversations from your network right now. Try again later." });

    // A day's worth from one source, older than an hour.
    const daily = sourceAddress();
    await startDraft(deps, host.handle, "Hello", { source: daily });
    const [hash] = await db<{ source_hash: string }[]>`
      select source_hash from app.request_creations where host_account_id = ${host.hostAccountId} order by created_at desc limit 1
    `;
    await db`update app.request_creations set created_at = now() - interval '2 hours' where source_hash = ${hash!.source_hash}`;
    await db`
      insert into app.request_creations (source_hash, host_account_id, created_at)
      select ${hash!.source_hash}, ${host.hostAccountId}, now() - interval '3 hours' from generate_series(1, 19)
    `;
    expect((await startDraft(deps, host.handle, "Hello", { source: daily })).status).toBe(429);

    // The service bound, with the day's count as the limit; no per-host bound.
    const [service] = await db<{ count: number }[]>`
      select count(*)::int as count from app.request_creations where created_at > now() - interval '24 hours'
    `;
    const full = guestDependencies(db, { creationLimits: { perSourceDay: 100, perSourceHour: 100, serviceDay: service!.count } });
    expect((await startDraft(full, host.handle, "Hello")).status).toBe(429);
    expect(CREATION_LIMITS).toEqual({ perSourceDay: 20, perSourceHour: 5, serviceDay: 500 });
  });

  it("answers an unready, suspended or unknown host with the neutral unavailable result and creates nothing", async () => {
    const suspended = await readyHost(db);
    await db`update app.host_accounts set status = 'suspended' where id = ${suspended.hostAccountId}`;
    const unready = await readyHost(db);
    await db`update app.provider_grants set invalidated_at = now() where host_account_id = ${unready.hostAccountId}`;
    const deps = guestDependencies(db);

    for (const host of [suspended, unready]) {
      const sent = await startDraft(deps, host.handle, "Hello");
      expect(sent.status).toBe(404);
      expect(await sent.json()).toEqual({ code: "unavailable", error: "This page is not taking requests." });
      const [count] = await db<{ count: number }[]>`
        select count(*)::int as count from app.requests where host_account_id = ${host.hostAccountId}
      `;
      expect(count!.count).toBe(0);
    }

    expect((await startDraft(deps, "no-such-host-here", "Hello")).status).toBe(404);
  });
});

describe("a draft", () => {
  it("accepts 30 messages, then calls for the identity card", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db, { draftMessageLimit: 3 });
    const { bookingId, requestId } = await startedDraft(deps, host.handle);

    expect((await message(deps, bookingId, "Two")).status).toBe(202);
    expect((await message(deps, bookingId, "Three")).status).toBe(202);
    expect((await requestRow(requestId))!.identity_requested_at).toBeNull();
    const fourth = await message(deps, bookingId, "Four");
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toMatchObject({ code: "draft_limit" });
    expect((await requestRow(requestId))!.identity_requested_at).not.toBeNull();
    expect(DRAFT_LIMITS.messages).toBe(30);

    // Identified, the cap no longer applies.
    expect((await identify(deps, bookingId)).status).toBe(200);
    expect((await message(deps, bookingId, "Four")).status).toBe(202);
  });

  it("is invisible to the host, holds no contact or email, and is deleted with its discussion after 24 hours", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);
    const session = await indexRequestSession(db, draft.requestId);
    // Spend that must survive the deletion, toward the service and anonymous allowances.
    await db`
      insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, session_id, amount_usd, window_start, anonymous)
      values ('conversation_input', ${session.inputId}, 'requester_request', ${draft.requestId}, ${session.sessionId}, 0.60,
              date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00'), true)
    `;

    // Host projections filter drafts out; the host has no request to see, and
    // link resend, which matches confirmed contacts, has none to match.
    expect(isHostVisibleRequestState("draft")).toBe(false);
    const [visible] = await db<{ count: number; draft: number }[]>`
      select count(*) filter (where state <> 'draft')::int as count, count(*) filter (where state = 'draft')::int as draft
      from app.requests where host_account_id = ${host.hostAccountId} and contact_confirmed_email is null and contact_email is null
    `;
    expect(visible).toEqual({ count: 0, draft: 1 });
    const [deliveries] = await db<{ count: number }[]>`
      select count(*)::int as count from app.email_deliveries where request_id = ${draft.requestId}
    `;
    expect(deliveries!.count).toBe(0);

    // 24 hours later the expiry job deletes the draft and its discussion.
    await db`update app.requests set expires_at = now() - interval '1 second' where id = ${draft.requestId}`;
    expect((await message(deps, draft.bookingId, "Still there?")).status).toBe(404);
    const job = await db.begin((tx) => publishJob(tx, { dedupeKey: `test:${randomUUID()}`, kind: REQUEST_EXPIRY_JOB }));
    expect(await runJob(db, job!, createRequestExpiryHandler(() => testNotices))).toBe("completed");

    const [left] = await db<{ discussions: number; inputs: number; links: number; requests: number; sessions: number }[]>`
      select (select count(*)::int from app.requests where id = ${draft.requestId}) as requests,
             (select count(*)::int from app.booking_links where request_id = ${draft.requestId}) as links,
             (select count(*)::int from app.discussions where id = ${draft.discussionId}) as discussions,
             (select count(*)::int from app.conversation_inputs where discussion_id = ${draft.discussionId}) as inputs,
             (select count(*)::int from app.agent_sessions where discussion_id = ${draft.discussionId}) as sessions
    `;
    expect(left).toEqual({ discussions: 0, inputs: 0, links: 0, requests: 0, sessions: 0 });
    const [spend] = await db<{ count: number }[]>`
      select count(*)::int as count from app.model_reservations where principal_id = ${draft.requestId} and session_id is null
    `;
    expect(spend!.count).toBe(1);
    const [creation] = await db<{ count: number }[]>`
      select count(*)::int as count from app.request_creations where host_account_id = ${host.hostAccountId}
    `;
    expect(creation!.count).toBe(1);
    expect((await call(createRequesterStateHandler(() => deps), { bookingId: draft.bookingId }, "/state")).status).toBe(404);
  });

  it("answers identity_required for evaluation, selection and agreement, and calls for the identity card", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const { bookingId, requestId } = await startedDraft(deps, host.handle);

    for (const [operation, input] of [
      ["request.evaluate", {}],
      ["request.choose_candidate", { candidateId: "c1", evaluationId: randomUUID() }],
      ["request.allow_trip", { candidateId: "c1", evaluationId: randomUUID(), minutes: 30 }],
      ["request.agree", { version: 1 }],
    ] as const) {
      const response = await command(deps, bookingId, operation, input);
      expect(response.status, operation).toBe(409);
      expect(await response.json(), operation).toMatchObject({ error: { category: "identity_required" }, ok: false });
    }

    const [evaluations] = await db<{ count: number }[]>`select count(*)::int as count from app.evaluations where request_id = ${requestId}`;
    expect(evaluations!.count).toBe(0);

    const state = (await (await call(createRequesterStateHandler(() => deps), { bookingId }, "/state")).json()) as {
      thread: { id: string; status: string }[];
    };
    expect(state.thread).toEqual([expect.objectContaining({ id: "identity", status: "open" })]);
  });

  it("gives the tools the same draft: reading and drafting work, evaluate_candidates answers identityRequired", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const { requestId } = await startedDraft(deps, host.handle);
    const session = await indexRequestSession(db, requestId);

    const read = await readRequestForTool(db, requesterCall(requestId, session.sessionId));
    expect(read).toMatchObject({ contact: { email: "absent", name: "absent" }, identified: false, readyForTimes: false, status: { state: "draft" } });

    const drafted = await draftRequestReviewForTool(db, requesterCall(requestId, session.sessionId), {
      details: { durationMinutes: 30, mode: "online", purpose: "Research collaboration", windows: [{ date: MONDAY, end: "12:00", start: "10:00" }] },
      intent: "details",
    });
    expect(drafted).toMatchObject({ recorded: true });

    // A draft's contact comes only from identification.
    const contact = await draftRequestReviewForTool(db, requesterCall(requestId, session.sessionId), {
      details: { contactEmail: "someone@example.test" },
      intent: "details",
    });
    expect(contact).toMatchObject({ problem: "invalid_contact", recorded: false });

    const evaluated = await evaluateCandidatesForTool(db, requesterCall(requestId, session.sessionId), { waitMs: 100 });
    expect(evaluated).toMatchObject({ evaluated: false, identityRequired: true });
    expect((await requestRow(requestId))!.identity_requested_at).not.toBeNull();
  });
});

describe("request.identify", () => {
  it("moves the draft to gathering in the same session, recomputes the expiry and sends the creation email", async () => {
    const host = await readyHost(db);
    const sent: Sent[] = [];
    const deps = guestDependencies(db, { runtime: recordingRuntime(sent) });
    const draft = await startedDraft(deps, host.handle);
    const session = await indexRequestSession(db, draft.requestId);

    // Details applied while a draft keep its 24-hour expiry and call for the identity card.
    await draftRequestReviewForTool(db, requesterCall(draft.requestId, session.sessionId), {
      details: { durationMinutes: 30, mode: "online", purpose: "Research collaboration", windows: [{ date: MONDAY, end: "12:00", start: "10:00" }] },
      intent: "details",
    });
    const [review] = await db<{ id: string }[]>`select id from app.request_reviews where request_id = ${draft.requestId} and state = 'pending'`;
    const before = await requestRow(draft.requestId);
    expect((await call(createRequesterCommandHandler(() => deps), { bookingId: draft.bookingId }, "/commands", {
      body: { expectedRevision: before!.revision, input: { reviewId: review!.id }, operation: "request.apply_review", retryKey: randomUUID() },
    })).status).toBe(200);
    const applied = await requestRow(draft.requestId);
    expect(applied).toMatchObject({ state: "draft" });
    expect(applied!.expires_at.getTime()).toBe(before!.expires_at.getTime());
    expect(applied!.identity_requested_at).not.toBeNull();

    const email = uniqueEmail();
    const retryKey = randomUUID();
    const response = await identify(deps, draft.bookingId, email, retryKey);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { state: "gathering" } });

    const identified = await requestRow(draft.requestId);
    expect(identified).toMatchObject({ contact_email: email, requester_name: "Grace Hopper", state: "gathering" });
    expect(identified!.identified_at).not.toBeNull();
    // The earlier of creation plus seven days and the latest window end, no
    // longer the draft's 24 hours.
    const windowEnd = Date.parse(`${MONDAY}T12:00:00+09:00`);
    expect(identified!.expires_at.getTime()).toBe(Math.min(identified!.created_at.getTime() + 7 * 86_400_000, windowEnd));

    const deliveries = await db<{ kind: string; recipients: string[] }[]>`
      select kind, recipients from app.email_deliveries where request_id = ${draft.requestId}
    `;
    expect(deliveries).toEqual([{ kind: "request_creation", recipients: [email] }]);

    // The same discussion, session and inputs: no new generation and no summary input.
    const sessions = await db<{ session_id: string }[]>`select session_id from app.agent_sessions where discussion_id = ${draft.discussionId}`;
    expect(sessions.map((row) => row.session_id)).toEqual([session.sessionId]);
    const inputs = await db<{ count: number }[]>`
      select count(*)::int as count from app.conversation_inputs where discussion_id = ${draft.discussionId}
    `;
    expect(inputs[0]!.count).toBe(1);

    // An exact retry answers the saved result; another identification is refused.
    expect((await identify(deps, draft.bookingId, email, retryKey)).status).toBe(200);
    expect((await identify(deps, draft.bookingId)).status).toBe(400);
    expect((await db`select 1 from app.email_deliveries where request_id = ${draft.requestId}`).count).toBe(1);

    const state = (await (await call(createRequesterStateHandler(() => deps), { bookingId: draft.bookingId }, "/state")).json()) as {
      contact: unknown;
      thread: { id: string; status: string }[];
    };
    expect(state.contact).toMatchObject({ confirmed: false, email, name: "Grace Hopper" });
    // One open card, the next step's: the Calendar step. Status is a line.
    expect(state.thread.map((card) => [card.id, card.status])).toEqual([
      [`review:${review!.id}`, "answered"],
      ["identity", "answered"],
      ["status:sent", "answered"],
      ["calendar", "open"],
    ]);
  });

  it("refuses an invalid email and an identification after the host stopped taking requests", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);

    expect((await command(deps, draft.bookingId, "request.identify", { email: "not-an-email", name: "Grace", timezone: "Asia/Seoul" })).status).toBe(400);
    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;
    expect((await identify(deps, draft.bookingId)).status).toBe(404);
    expect((await requestRow(draft.requestId))!.state).toBe("draft");
  });
});

describe("the unconfirmed model cap on drafts", () => {
  const reply = {
    content: [{ text: "Hello.", type: "text" as const }],
    finishReason: { raw: "stop", unified: "stop" as const },
    usage: {
      inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
      outputTokens: { reasoning: 0, text: 1, total: 1 },
    },
    warnings: [],
  };
  const model = () => new MockLanguageModelV4({ doGenerate: async () => reply, modelId: "gpt-5.6-terra", provider: "openai.responses" });
  const prompt = (key: string) => ({ prompt: "Hello", providerOptions: { openai: { promptCacheKey: key } } });

  it("caps a draft at USD 3 and counts it as anonymous", async () => {
    const host = await readyHost(db);
    const draft = await startedDraft(guestDependencies(db), host.handle);
    const session = await indexRequestSession(db, draft.requestId);
    const wrapped = limitModel(model(), () => ({ db, limits: { serviceWindowUsd: "1000000.00" } }));

    // USD 3 at USD 0.60 a reservation is five attempts; one input has eight.
    for (let index = 0; index < 5; index += 1) await generateText({ model: wrapped, ...prompt(session.key) });
    await expect(generateText({ model: wrapped, ...prompt(session.key) })).rejects.toMatchObject({ code: "principal_allowance" });
    const marked = await db<{ anonymous: boolean }[]>`
      select distinct anonymous from app.model_reservations where principal_id = ${draft.requestId}
    `;
    expect(marked).toEqual([{ anonymous: true }]);
  });

  it("lets Continue without Google identify the guest while anonymous messages are refused", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);
    const session = await indexRequestSession(db, draft.requestId);
    const refusing = limitModel(model(), () => ({ db, limits: { anonymousWindowUsd: "0.01", serviceWindowUsd: "1000000.00" } }));
    await expect(generateText({ model: refusing, ...prompt(session.key) })).rejects.toMatchObject({ code: "anonymous_allowance" });

    expect((await identify(deps, draft.bookingId)).status).toBe(200);
    const [reserved] = await db<{ count: number }[]>`
      select count(*)::int as count from app.model_reservations where principal_id = ${draft.requestId}
    `;
    expect(reserved!.count).toBe(0);
  });

  it("refuses model work for an expired draft", async () => {
    const host = await readyHost(db);
    const draft = await startedDraft(guestDependencies(db), host.handle);
    const session = await indexRequestSession(db, draft.requestId);
    await db`update app.requests set expires_at = now() - interval '1 second' where id = ${draft.requestId}`;
    const wrapped = limitModel(model(), () => ({ db, limits: { serviceWindowUsd: "1000000.00" } }));

    await expect(generateText({ model: wrapped, ...prompt(sessionIdHash(session.sessionId)) })).rejects.toMatchObject({
      code: "authority_expired",
    });
  });
});

describe("an intake from before D13", () => {
  it("stays readable while the request it became is open, and takes no more conversation work", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);
    expect((await identify(deps, draft.bookingId)).status).toBe(200);

    // An intake row as the retired flow left it: continued into the request.
    const intakeId = randomUUID();
    const [discussion] = await db<{ id: string }[]>`
      insert into app.discussions (principal_type, principal_id, audience)
      values ('public_intake', ${intakeId}, 'public_intake') returning id
    `;
    await db`
      insert into app.intakes (id, host_account_id, token_hash, source_hash, discussion_id, draft, request_id, closed_at)
      values (${intakeId}, ${host.hostAccountId}, ${randomUUID()}, ${randomUUID()}, ${discussion!.id}, '{}'::jsonb,
              ${draft.requestId}, now())
    `;
    const sessionId = `wrun_${randomUUID()}`;
    await db`
      insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
      values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussion!.id}, 'public_intake', ${intakeId}, 1, 'test')
    `;

    const appAuth = createAppAuth(() => ({ auth: localAuthConfig(), db, signingKey: SIGNING_KEY }));
    const principal = { id: intakeId, type: "public_intake" as const };
    const read = () =>
      appAuth(
        new Request(`http://127.0.0.1/eve/v1/session/${sessionId}/stream`, {
          headers: {
            authorization: `Bearer ${signInternalBearer(
              { discussionId: discussion!.id, generation: 1, kind: "read", principal, sessionId },
              SIGNING_KEY,
            )}`,
          },
          method: "GET",
        }),
      );
    const create = () =>
      appAuth(
        new Request("http://127.0.0.1/eve/v1/session", {
          headers: {
            authorization: `Bearer ${signInternalBearer({ discussionId: discussion!.id, generation: 2, kind: "create", principal }, SIGNING_KEY)}`,
          },
          method: "POST",
        }),
      );

    await expect(read()).resolves.toMatchObject({ attributes: { audience: "public_intake" } });
    await expect(create()).rejects.toMatchObject({ name: "ForbiddenError" });

    const state = (await (await call(createRequesterStateHandler(() => deps), { bookingId: draft.bookingId }, "/state")).json()) as {
      hasIntakeTranscript: boolean;
    };
    expect(state.hasIntakeTranscript).toBe(true);

    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${draft.requestId}`;
    await expect(read()).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

async function threadOf(deps: RequesterRouteDependencies, bookingId: string) {
  const response = await call(createRequesterStateHandler(() => deps), { bookingId }, "/state");
  return ((await response.json()) as { thread: { id: string; receipt?: { text: string }; status: string }[] }).thread;
}

function openCards(thread: { id: string; status: string }[]) {
  return thread.filter((card) => card.status === "open").map((card) => card.id);
}

describe("one thing at a time", () => {
  it("opens the identity card when the assistant calls ask_for_identity, before any review", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);
    const session = await indexRequestSession(db, draft.requestId);
    expect(await threadOf(deps, draft.bookingId)).toEqual([]);

    // A pending review is the open card until identity is asked for.
    await draftRequestReviewForTool(db, requesterCall(draft.requestId, session.sessionId), {
      details: { purpose: "Research collaboration" },
      intent: "details",
    });
    expect(openCards(await threadOf(deps, draft.bookingId))).toEqual([expect.stringMatching(/^review:/)]);

    expect(await askForIdentityForTool(db, requesterCall(draft.requestId, session.sessionId))).toMatchObject({ identityRequested: true });
    const thread = await threadOf(deps, draft.bookingId);
    expect(openCards(thread)).toEqual(["identity"]);
    expect(thread.find((card) => card.id.startsWith("review:"))).toMatchObject({ status: "waiting" });

    // Once identified, the review drafted while a draft is the open card and
    // still applies; the tool does nothing.
    expect((await identify(deps, draft.bookingId)).status).toBe(200);
    expect(openCards(await threadOf(deps, draft.bookingId))).toEqual([expect.stringMatching(/^review:/)]);
    const [pending] = await db<{ id: string }[]>`select id from app.request_reviews where request_id = ${draft.requestId} and state = 'pending'`;
    const [current] = await db<{ revision: number }[]>`select revision from app.requests where id = ${draft.requestId}`;
    const applied = await call(createRequesterCommandHandler(() => deps), { bookingId: draft.bookingId }, "/commands", {
      body: { expectedRevision: current!.revision, input: { reviewId: pending!.id }, operation: "request.apply_review", retryKey: randomUUID() },
    });
    expect(applied.status).toBe(200);
    expect(await askForIdentityForTool(db, requesterCall(draft.requestId, session.sessionId))).toMatchObject({ identityRequested: false });
  });

  it("keeps Skip for now on the server, moves to Find times, and Change offers the Calendar card again", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);

    // Not before identification.
    const early = await command(deps, draft.bookingId, "request.set_manual_availability", { manual: true });
    expect(early.status).toBe(409);
    expect((await identify(deps, draft.bookingId)).status).toBe(200);
    expect(openCards(await threadOf(deps, draft.bookingId))).toEqual(["calendar"]);

    expect((await command(deps, draft.bookingId, "request.set_manual_availability", { manual: true })).status).toBe(200);
    // Another read, as after a reload or in another tab: still settled.
    const skipped = await threadOf(deps, draft.bookingId);
    expect(openCards(skipped)).toEqual(["times:find"]);
    expect(skipped.find((card) => card.id === "calendar")).toMatchObject({ receipt: { text: "Skipped" }, status: "answered" });

    expect((await command(deps, draft.bookingId, "request.set_manual_availability", { manual: false })).status).toBe(200);
    expect(openCards(await threadOf(deps, draft.bookingId))).toEqual(["calendar"]);
  });
});
