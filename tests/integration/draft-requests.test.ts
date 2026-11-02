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
  identifiedRequest,
  startDraft,
  startedDraft,
} from "./support/guests";
import { runJob, testNotices, uniqueEmail } from "./support/requests";

// The web start and its fixed steps (guest-flow-completion U7 to U10):
// request.start on Continue with or without Google, with its bounds and retry
// identity and no message; the hidden draft, which accepts no message, is
// invisible to the host and is deleted after 24 hours; identity_required on
// each gated operation; request.identify sending the creation email and
// settling the Calendar step; the meeting step as the first open card, then
// Find times with no windows; the unconfirmed-request model cap on drafts; and
// the transcript of an intake from before D13 staying readable. A recording
// runtime stands in for eve.

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

describe("request.start", () => {
  it("writes a hidden draft with a hashed and sealed link and its discussion, and sends no message", async () => {
    const host = await readyHost(db);
    const sent: Sent[] = [];
    const deps = guestDependencies(db, { runtime: recordingRuntime(sent) });
    const nonce = randomUUID();

    const response = await startDraft(deps, host.handle, { nonce });
    expect(response.status).toBe(201);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { bookingId } = (await response.json()) as { bookingId: string };

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

    // No message and no session: nothing reaches the model before identification.
    const [inputs] = await db<{ count: number }[]>`
      select count(*)::int as count from app.conversation_inputs i
      join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${request!.id}
    `;
    expect(inputs!.count).toBe(0);
    expect(sent).toEqual([]);

    // The saved outcome holds no booking link; the actor is the nonce's hash.
    const [outcome] = await db<{ result: unknown }[]>`
      select result from app.command_outcomes where actor = ${`guest_starter:${starterId(nonce)}`}
    `;
    expect(JSON.stringify(outcome!.result)).not.toContain(bookingId);
    expect(JSON.stringify(outcome)).not.toContain(nonce);

    const state = await call(createRequesterStateHandler(() => deps), { bookingId }, "/state");
    expect(await state.json()).toMatchObject({ contact: null, open: true, request: { state: "draft" }, thread: [] });
  });

  it("answers the same draft to a retried start, as after a cancelled Google consent, and charges its bound once", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const nonce = randomUUID();
    const send = () => startDraft(deps, host.handle, { nonce });

    const [first, second] = await Promise.all([send(), send()]);
    const answers = await Promise.all([first.json(), second.json()]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(answers[0].bookingId).toBe(answers[1].bookingId);

    // A later retry, as when the guest tries Google again, answers the same draft too.
    const third = await send();
    expect(((await third.json()) as { bookingId: string }).bookingId).toBe(answers[0].bookingId);

    const [counts] = await db<{ creations: number; requests: number }[]>`
      select (select count(*)::int from app.requests where host_account_id = ${host.hostAccountId}) as requests,
             (select count(*)::int from app.request_creations where host_account_id = ${host.hostAccountId}) as creations
    `;
    expect(counts).toEqual({ creations: 1, requests: 1 });
  });

  it("bounds drafts to 5 per source an hour, 20 a day and 500 across the service a day", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db, { creationLimits: { serviceDay: Number.POSITIVE_INFINITY } });
    const source = sourceAddress();

    for (let index = 0; index < CREATION_LIMITS.perSourceHour; index += 1) {
      expect((await startDraft(deps, host.handle, { source })).status).toBe(201);
    }

    const sixth = await startDraft(deps, host.handle, { source });
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ code: "rate_limited", error: "Too many new requests from your network right now. Try again later." });

    // A day's worth from one source, older than an hour.
    const daily = sourceAddress();
    await startDraft(deps, host.handle, { source: daily });
    const [hash] = await db<{ source_hash: string }[]>`
      select source_hash from app.request_creations where host_account_id = ${host.hostAccountId} order by created_at desc limit 1
    `;
    await db`update app.request_creations set created_at = now() - interval '2 hours' where source_hash = ${hash!.source_hash}`;
    await db`
      insert into app.request_creations (source_hash, host_account_id, created_at)
      select ${hash!.source_hash}, ${host.hostAccountId}, now() - interval '3 hours' from generate_series(1, 19)
    `;
    expect((await startDraft(deps, host.handle, { source: daily })).status).toBe(429);

    // The service bound, with the day's count as the limit; no per-host bound.
    const [service] = await db<{ count: number }[]>`
      select count(*)::int as count from app.request_creations where created_at > now() - interval '24 hours'
    `;
    const full = guestDependencies(db, { creationLimits: { perSourceDay: 100, perSourceHour: 100, serviceDay: service!.count } });
    expect((await startDraft(full, host.handle)).status).toBe(429);
    expect(CREATION_LIMITS).toEqual({ perSourceDay: 20, perSourceHour: 5, serviceDay: 500 });
  });

  it("answers an unready, suspended or unknown host with the neutral unavailable result and creates nothing", async () => {
    const suspended = await readyHost(db);
    await db`update app.host_accounts set status = 'suspended' where id = ${suspended.hostAccountId}`;
    const unready = await readyHost(db);
    await db`update app.provider_grants set invalidated_at = now() where host_account_id = ${unready.hostAccountId}`;
    const deps = guestDependencies(db);

    for (const host of [suspended, unready]) {
      const sent = await startDraft(deps, host.handle);
      expect(sent.status).toBe(404);
      expect(await sent.json()).toEqual({ code: "unavailable", error: "This page is not taking requests." });
      const [count] = await db<{ count: number }[]>`
        select count(*)::int as count from app.requests where host_account_id = ${host.hostAccountId}
      `;
      expect(count!.count).toBe(0);
    }

    expect((await startDraft(deps, "no-such-host-here")).status).toBe(404);
  });
});

describe("a draft", () => {
  it("accepts no message until the guest is identified", async () => {
    const host = await readyHost(db);
    const sent: Sent[] = [];
    const deps = guestDependencies(db, { runtime: recordingRuntime(sent) });
    const { bookingId } = await startedDraft(deps, host.handle);

    const refused = await message(deps, bookingId, "Hello");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "draft_limit" });
    expect(DRAFT_LIMITS.messages).toBe(0);
    expect(sent).toEqual([]);

    expect((await identify(deps, bookingId)).status).toBe(200);
    expect((await message(deps, bookingId, "Mornings, please.")).status).toBe(202);
    expect(sent.map((entry) => entry.message)).toEqual(["Mornings, please."]);
  });

  it("is invisible to the host, holds no contact or email, and is deleted with its discussion after 24 hours", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);

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

    const [left] = await db<{ discussions: number; links: number; requests: number }[]>`
      select (select count(*)::int from app.requests where id = ${draft.requestId}) as requests,
             (select count(*)::int from app.booking_links where request_id = ${draft.requestId}) as links,
             (select count(*)::int from app.discussions where id = ${draft.discussionId}) as discussions
    `;
    expect(left).toEqual({ discussions: 0, links: 0, requests: 0 });
    const [creation] = await db<{ count: number }[]>`
      select count(*)::int as count from app.request_creations where host_account_id = ${host.hostAccountId}
    `;
    expect(creation!.count).toBe(1);
    expect((await call(createRequesterStateHandler(() => deps), { bookingId: draft.bookingId }, "/state")).status).toBe(404);
  });

  it("answers identity_required for evaluation, selection and agreement", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const { bookingId, requestId } = await startedDraft(deps, host.handle);

    for (const [operation, input] of [
      ["request.evaluate", {}],
      ["request.choose_candidate", { candidateId: "c1", evaluationId: randomUUID() }],
      ["request.allow_trip", { candidateId: "c1", evaluationId: randomUUID(), minutes: 30 }],
      ["request.agree", { version: 1 }],
      ["request.set_manual_availability", { manual: true }],
    ] as const) {
      const response = await command(deps, bookingId, operation, input);
      expect(response.status, operation).toBe(409);
      expect(await response.json(), operation).toMatchObject({ error: { category: "identity_required" }, ok: false });
    }

    const [evaluations] = await db<{ count: number }[]>`select count(*)::int as count from app.evaluations where request_id = ${requestId}`;
    expect(evaluations!.count).toBe(0);
  });
});

describe("request.identify", () => {
  it("moves the draft to gathering, sets the seven-day expiry, sends the creation email and settles the Calendar step", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await startedDraft(deps, host.handle);

    const email = uniqueEmail();
    const retryKey = randomUUID();
    const response = await identify(deps, draft.bookingId, email, retryKey);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { state: "gathering" } });

    const identified = await requestRow(draft.requestId);
    expect(identified).toMatchObject({ contact_email: email, requester_name: "Grace Hopper", state: "gathering" });
    expect(identified!.identified_at).not.toBeNull();
    // No windows: creation plus seven days, no longer the draft's 24 hours.
    expect(identified!.expires_at.getTime()).toBe(identified!.created_at.getTime() + 7 * 86_400_000);

    const deliveries = await db<{ kind: string; recipients: string[] }[]>`
      select kind, recipients from app.email_deliveries where request_id = ${draft.requestId}
    `;
    expect(deliveries).toEqual([{ kind: "request_creation", recipients: [email] }]);

    // An exact retry answers the saved result; another identification is refused.
    expect((await identify(deps, draft.bookingId, email, retryKey)).status).toBe(200);
    expect((await identify(deps, draft.bookingId)).status).toBe(400);
    expect((await db`select 1 from app.email_deliveries where request_id = ${draft.requestId}`).count).toBe(1);

    const state = (await (await call(createRequesterStateHandler(() => deps), { bookingId: draft.bookingId }, "/state")).json()) as {
      contact: unknown;
      meeting: unknown;
      thread: { id: string; receipt?: { text: string }; status: string }[];
    };
    expect(state.contact).toMatchObject({ confirmed: false, email, name: "Grace Hopper" });
    // Without Google the Calendar step is settled as skipped; the one open
    // card is the meeting step, with the host's meeting.
    expect(state.thread.map((card) => [card.id, card.status, card.receipt?.text])).toEqual([
      ["identity", "answered", `Grace Hopper · ${email}`],
      ["status:sent", "answered", undefined],
      ["calendar", "answered", "Skipped"],
      ["meeting", "open", undefined],
    ]);
    expect(state.meeting).toEqual({ durationMinutes: 30, meetingMode: expect.any(String), venue: null });
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

describe("the fixed steps", () => {
  it("opens the meeting step, then finds times over the default range with no windows", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await identifiedRequest(deps, host.handle, { email: uniqueEmail() });
    expect(openCards(await threadOf(deps, draft.bookingId))).toEqual(["meeting"]);

    // Find times waits for the meeting step: no purpose yet.
    const [before] = await db<{ revision: number }[]>`select revision from app.requests where id = ${draft.requestId}`;
    const saved = await call(createRequesterCommandHandler(() => deps), { bookingId: draft.bookingId }, "/commands", {
      body: {
        expectedRevision: before!.revision,
        input: { details: { durationMinutes: 30, mode: "online", purpose: "Talk about compilers" }, timezone: "Asia/Seoul" },
        operation: "request.update_details",
        retryKey: randomUUID(),
      },
    });
    expect(saved.status).toBe(200);

    const thread = await threadOf(deps, draft.bookingId);
    expect(thread.find((card) => card.id === "meeting")).toMatchObject({ receipt: { text: "Talk about compilers" }, status: "answered" });
    expect(openCards(thread)).toEqual(["times:find"]);

    // No windows are needed: the evaluation is published at once.
    const evaluated = await command(deps, draft.bookingId, "request.evaluate");
    expect(evaluated.status).toBe(200);
    const [evaluations] = await db<{ count: number }[]>`select count(*)::int as count from app.evaluations where request_id = ${draft.requestId}`;
    expect(evaluations!.count).toBe(1);
  });

  it("keeps the Calendar step on the server, and Change offers the Calendar card again", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const draft = await identifiedRequest(deps, host.handle, { email: uniqueEmail() });
    await db`update app.requests set details = details || '{"purpose": "Talk about compilers"}'::jsonb where id = ${draft.requestId}`;

    // Another read, as after a reload or in another tab: still settled.
    const skipped = await threadOf(deps, draft.bookingId);
    expect(openCards(skipped)).toEqual(["times:find"]);
    expect(skipped.find((card) => card.id === "calendar")).toMatchObject({ receipt: { text: "Skipped" }, status: "answered" });

    expect((await command(deps, draft.bookingId, "request.set_manual_availability", { manual: false })).status).toBe(200);
    expect(openCards(await threadOf(deps, draft.bookingId))).toEqual(["calendar"]);
    expect((await command(deps, draft.bookingId, "request.set_manual_availability", { manual: true })).status).toBe(200);
    expect(openCards(await threadOf(deps, draft.bookingId))).toEqual(["times:find"]);
  });
});
