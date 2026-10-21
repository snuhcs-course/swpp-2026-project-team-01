import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import { hashBookingId } from "../../lib/server/booking-links";
import {
  createIntakeContinueHandler,
  createIntakeMessageHandler,
  createIntakeStateHandler,
  type IntakeRouteDependencies,
} from "../../lib/server/intake-routes";
import { draftIntakeForTool, readIntakeForTool } from "../../lib/server/intake-tools";
import { createIntake, hashIntakeToken, INTAKE_LIMITS } from "../../lib/server/intakes";
import { limitModel, sessionIdHash } from "../../lib/server/model-limits";
import { CREATION_LIMITS } from "../../lib/server/request-creation";
import { testDatabase } from "./support/database";
import { call, guestDependencies, indexIntakeSession, readyHost, recordingRuntime, type Sent, sourceAddress } from "./support/guests";
import { uniqueEmail } from "./support/requests";

// The public intake and request creation (task 3.1): the intake token and its
// bounds, the message cap, the anonymous model allowance, the intake tools'
// reach, request.create with its bounds, retry identity and neutral answers,
// and what creation leaves behind. A recording runtime stands in for eve; the
// session's tool list is covered against a real agent in guest-conversations.

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

function message(deps: IntakeRouteDependencies, handle: string, text: string, options: { token?: string; source?: string } = {}) {
  return call(createIntakeMessageHandler(() => deps), { handle }, `/api/intake/${handle}/messages`, {
    body: { clientInputId: randomUUID(), language: "en", message: text, timezone: "Asia/Seoul" },
    headers: options.token ? { "x-intake-token": options.token } : {},
    source: options.source,
  });
}

function continueWithout(
  deps: IntakeRouteDependencies,
  handle: string,
  token: string | undefined,
  body: Record<string, string> = { email: uniqueEmail(), language: "en", name: "Grace Hopper", timezone: "Asia/Seoul" },
  source?: string,
) {
  return call(createIntakeContinueHandler(() => deps), { handle }, `/api/intake/${handle}/continue`, {
    body,
    headers: token ? { "x-intake-token": token } : {},
    source,
  });
}

async function startedIntake(deps: IntakeRouteDependencies, handle: string, source = sourceAddress()) {
  const response = await message(deps, handle, "I'd like to talk about a research collaboration.", { source });
  expect(response.status).toBe(202);
  const body = (await response.json()) as { intakeToken: string };
  const [intake] = await db<{ id: string }[]>`select id from app.intakes where token_hash = ${hashIntakeToken(body.intakeToken)}`;
  return { intakeId: intake!.id, token: body.intakeToken };
}

describe("intake conversation", () => {
  it("starts an intake on the first message, stores only the token's hash and delivers the message", async () => {
    const host = await readyHost(db);
    const sent: Sent[] = [];
    const deps = guestDependencies(db, { runtime: recordingRuntime(sent) });
    const { intakeId, token } = await startedIntake(deps, host.handle);

    const [row] = await db<{ draft: Record<string, string>; token_hash: string }[]>`
      select token_hash, draft from app.intakes where id = ${intakeId}
    `;
    expect(row!.token_hash).toBe(hashIntakeToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.draft).toMatchObject({ language: "en", timezone: "Asia/Seoul" });
    expect(sent.map((entry) => entry.message)).toEqual(["I'd like to talk about a research collaboration."]);

    // The same tab continues the same intake.
    const second = await message(deps, host.handle, "Thirty minutes, online.", { token });
    expect(second.status).toBe(202);
    expect(((await second.json()) as { intakeToken?: string }).intakeToken).toBeUndefined();
    const state = await call(createIntakeStateHandler(() => deps), { handle: host.handle }, `/api/intake/${host.handle}/state`, {
      headers: { "x-intake-token": token },
    });
    expect(await state.json()).toMatchObject({ intake: { continued: false, open: true } });
  });

  it("bounds new intakes to 5 per source address an hour and 20 a day", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const source = sourceAddress();

    for (let index = 0; index < INTAKE_LIMITS.perSourceHour; index += 1) {
      expect((await message(deps, host.handle, "Hello", { source })).status).toBe(202);
    }

    const sixth = await message(deps, host.handle, "Hello", { source });
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toMatchObject({ code: "rate_limited" });

    // The day bound: older intakes from the same source within 24 hours.
    const daily = sourceAddress();
    const first = await startedIntake(deps, host.handle, daily);
    const [sourceRow] = await db<{ source_hash: string }[]>`select source_hash from app.intakes where id = ${first.intakeId}`;
    await db`update app.intakes set created_at = now() - interval '2 hours' where id = ${first.intakeId}`;
    for (let index = 1; index < INTAKE_LIMITS.perSourceDay; index += 1) {
      await createIntake(db, { hostAccountId: host.hostAccountId, limits: { perSourceHour: 100 }, sourceHash: sourceRow!.source_hash });
    }
    await db`update app.intakes set created_at = now() - interval '2 hours' where source_hash = ${sourceRow!.source_hash}`;

    const overDay = await message(deps, host.handle, "Hello", { source: daily });
    expect(overDay.status).toBe(429);
  });

  it("accepts 30 messages per intake, then asks the visitor to continue", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db, { intakeMessageLimit: 3 });
    const { token } = await startedIntake(deps, host.handle);

    expect((await message(deps, host.handle, "Two", { token })).status).toBe(202);
    expect((await message(deps, host.handle, "Three", { token })).status).toBe(202);
    const fourth = await message(deps, host.handle, "Four", { token });
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toMatchObject({ code: "intake_limit" });
    expect(INTAKE_LIMITS.messages).toBe(30);
  });

  it("answers an unready or suspended host with the neutral unavailable result and creates nothing", async () => {
    const suspended = await readyHost(db);
    await db`update app.host_accounts set status = 'suspended' where id = ${suspended.hostAccountId}`;
    const unready = await readyHost(db);
    await db`update app.provider_grants set invalidated_at = now() where host_account_id = ${unready.hostAccountId}`;
    const deps = guestDependencies(db);

    for (const host of [suspended, unready]) {
      const sent = await message(deps, host.handle, "Hello");
      expect(sent.status).toBe(404);
      expect(await sent.json()).toEqual({ code: "unavailable", error: "This page is not taking requests." });
      const continued = await continueWithout(deps, host.handle, undefined);
      expect(continued.status).toBe(404);
      const [count] = await db<{ count: number }[]>`
        select count(*)::int as count from app.requests where host_account_id = ${host.hostAccountId}
      `;
      expect(count!.count).toBe(0);
    }

    expect((await message(deps, "no-such-host-here", "Hello")).status).toBe(404);
  });

  it("refuses an intake that suspended while it was open, at continue", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const { token } = await startedIntake(deps, host.handle);
    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;

    expect((await continueWithout(deps, host.handle, token)).status).toBe(404);
  });
});

describe("intake tools", () => {
  it("read_intake returns only the host's public profile and the intake's own draft", async () => {
    const host = await readyHost(db, { displayName: "Ada [Lovelace](https://x.example)" });
    const deps = guestDependencies(db);
    const { intakeId } = await startedIntake(deps, host.handle);
    const session = await indexIntakeSession(db, intakeId);
    const auth = { attributes: { audience: "public_intake" }, principalId: `intake:${intakeId}`, principalType: "user" };

    const projection = await readIntakeForTool(db, { auth, sessionId: session.sessionId });
    expect(projection.host.handle).toBe(host.handle);
    expect(projection.host.displayName).not.toContain("](");
    expect(Object.keys(projection).sort()).toEqual(["dataNote", "draft", "host", "language", "missing", "next", "timezone"]);
    expect(JSON.stringify(projection)).not.toMatch(/bookingCalendar|refresh|settings|weekly/i);

    const recorded = await draftIntakeForTool(db, { auth, sessionId: session.sessionId }, {
      durationMinutes: 30,
      mode: "online",
      purpose: "Research collaboration",
    });
    expect(recorded).toMatchObject({ intake: { draft: { durationMinutes: 30, mode: "online", purpose: "Research collaboration" } }, recorded: true });
  });

  it("refuses another audience, another intake's session and a continued intake", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const first = await startedIntake(deps, host.handle);
    const second = await startedIntake(deps, host.handle);
    const session = await indexIntakeSession(db, first.intakeId);
    const as = (principalId: string, audience = "public_intake") => ({
      auth: { attributes: { audience }, principalId, principalType: "user" },
      sessionId: session.sessionId,
    });

    await expect(readIntakeForTool(db, as(`intake:${second.intakeId}`))).rejects.toThrow("cannot use intake tools");
    await expect(readIntakeForTool(db, as(`intake:${first.intakeId}`, "requester"))).rejects.toThrow("cannot use intake tools");
    await expect(readIntakeForTool(db, as(first.intakeId))).rejects.toThrow("cannot use intake tools");

    await db`update app.intakes set closed_at = now() where id = ${first.intakeId}`;
    await expect(readIntakeForTool(db, as(`intake:${first.intakeId}`))).rejects.toThrow("cannot use intake tools");
  });
});

describe("local times in the visitor's timezone", () => {
  async function newYorkIntake(language: "en" | "ko" = "en") {
    const host = await readyHost(db);
    const created = await createIntake(db, {
      draft: { language, timezone: "America/New_York" },
      hostAccountId: host.hostAccountId,
      sourceHash: randomUUID(),
    });
    const session = await indexIntakeSession(db, created.intakeId);
    return {
      call: { auth: { attributes: { audience: "public_intake" }, principalId: `intake:${created.intakeId}`, principalType: "user" }, sessionId: session.sessionId },
      intakeId: created.intakeId,
    };
  }

  it("asks the authored ambiguous_local_time question for a repeated local time and records nothing", async () => {
    const intake = await newYorkIntake();
    const outcome = await draftIntakeForTool(db, intake.call, { windows: [{ date: "2026-11-01", end: "03:00", start: "01:30" }] }, Date.parse("2026-10-21T00:00:00Z"));

    expect(outcome).toMatchObject({ clarification: "ambiguous_local_time", problem: "ambiguous_local_time", recorded: false });
    const [row] = await db<{ draft: Record<string, unknown> }[]>`select draft from app.intakes where id = ${intake.intakeId}`;
    expect(row!.draft.windows).toBeUndefined();
  });

  it("asks the same question in Korean for a skipped local time", async () => {
    const intake = await newYorkIntake("ko");
    const outcome = await draftIntakeForTool(db, intake.call, { windows: [{ date: "2027-03-14", end: "04:00", start: "02:30" }] }, Date.parse("2026-10-21T00:00:00Z"));

    expect(outcome).toMatchObject({ clarification: "ambiguous_local_time", recorded: false });
    expect((outcome as { question: string }).question).toMatch(/시간 변경/);
  });

  it("records the window either side of the change with that date's offset", async () => {
    const intake = await newYorkIntake();
    const outcome = await draftIntakeForTool(
      db,
      intake.call,
      { windows: [{ date: "2026-10-31", end: "11:00", start: "10:00" }, { date: "2026-11-02", end: "11:00", start: "10:00" }] },
      Date.parse("2026-10-21T00:00:00Z"),
    );

    expect(outcome).toMatchObject({
      intake: { draft: { windows: ["Sat 31 Oct, 10:00 GMT-4 to Sat 31 Oct, 11:00 GMT-4", "Mon 2 Nov, 10:00 GMT-5 to Mon 2 Nov, 11:00 GMT-5"] } },
      recorded: true,
    });
  });
});

describe("anonymous model allowance", () => {
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
  const prompt = (key: string) => ({
    prompt: "Hello",
    providerOptions: { openai: { promptCacheKey: key } },
  });

  async function intakeSession() {
    const host = await readyHost(db);
    const created = await createIntake(db, { hostAccountId: host.hostAccountId, sourceHash: randomUUID() });
    return { ...created, ...(await indexIntakeSession(db, created.intakeId)) };
  }

  it("caps one intake at USD 3 and every intake together at USD 50, within the service window", async () => {
    const session = await intakeSession();
    const wrapped = limitModel(model(), () => ({ db, limits: { serviceWindowUsd: "1000000.00" } }));

    // USD 3 at USD 0.60 a reservation is five attempts; one input has eight.
    for (let index = 0; index < 5; index += 1) await generateText({ model: wrapped, ...prompt(session.key) });
    await expect(generateText({ model: wrapped, ...prompt(session.key) })).rejects.toMatchObject({ code: "principal_allowance" });

    // The anonymous allowance counts every intake: with the rest already spent,
    // a fresh intake is refused although its own allowance is untouched.
    const fresh = await intakeSession();
    const [spent] = await db<{ total: string }[]>`
      select coalesce(sum(amount_usd), 0)::text as total from app.model_reservations
      where (anonymous or principal_type = 'public_intake')
        and window_start = date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
    `;
    const anonymous = Math.ceil((Number(spent!.total) + 0.6) * 100) / 100;
    const capped = limitModel(model(), () => ({ db, limits: { anonymousWindowUsd: anonymous.toFixed(2), serviceWindowUsd: "1000000.00" } }));
    await generateText({ model: capped, ...prompt(fresh.key) });
    await expect(generateText({ model: capped, ...prompt(fresh.key) })).rejects.toMatchObject({ code: "anonymous_allowance" });
  });

  it("refuses model work for a continued intake", async () => {
    const session = await intakeSession();
    await db`update app.intakes set closed_at = now() where id = ${session.intakeId}`;
    const wrapped = limitModel(model(), () => ({ db, limits: { serviceWindowUsd: "1000000.00" } }));

    await expect(generateText({ model: wrapped, ...prompt(sessionIdHash(session.sessionId)) })).rejects.toMatchObject({
      code: "authority_expired",
    });
  });

  it("lets Continue without Google create a request while anonymous messages are refused", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const { intakeId, token } = await startedIntake(deps, host.handle);
    const session = await indexIntakeSession(db, intakeId);
    // The anonymous allowance is used up for this intake's messages...
    const refusing = limitModel(model(), () => ({ db, limits: { anonymousWindowUsd: "0.01", serviceWindowUsd: "1000000.00" } }));
    await expect(generateText({ model: refusing, ...prompt(session.key) })).rejects.toMatchObject({ code: "anonymous_allowance" });

    // ...and creation needs none of it.
    const response = await continueWithout(deps, host.handle, token);
    expect(response.status).toBe(201);
    const [reserved] = await db<{ count: number }[]>`
      select count(*)::int as count from app.model_reservations where principal_id = ${intakeId}
    `;
    expect(reserved!.count).toBe(0);
  });
});

describe("request.create", () => {
  it("creates one request with a hashed and sealed link, its discussion, the draft as a pending review and the creation email", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const { intakeId, token } = await startedIntake(deps, host.handle);
    const session = await indexIntakeSession(db, intakeId);
    const auth = { attributes: { audience: "public_intake" }, principalId: `intake:${intakeId}`, principalType: "user" };
    await draftIntakeForTool(db, { auth, sessionId: session.sessionId }, { durationMinutes: 45, purpose: "Research collaboration" });
    const email = uniqueEmail();

    const response = await continueWithout(deps, host.handle, token, { email, language: "en", name: "Grace Hopper", timezone: "Asia/Seoul" });
    expect(response.status).toBe(201);
    const { bookingId, bookingUrl } = (await response.json()) as { bookingId: string; bookingUrl: string };
    expect(bookingUrl).toBe(`http://localhost:3000/booking/${bookingId}`);

    const [request] = await db<
      { contact_confirmed_email: string | null; contact_email: string; expires_at: Date; id: string; link_ciphertext: string; link_hash: string; state: string }[]
    >`
      select r.id, r.state, r.contact_email, r.contact_confirmed_email, r.expires_at, l.link_hash, l.link_ciphertext
      from app.requests r join app.booking_links l on l.request_id = r.id
      where r.host_account_id = ${host.hostAccountId}
    `;
    expect(request).toMatchObject({ contact_confirmed_email: null, contact_email: email, link_hash: hashBookingId(bookingId), state: "gathering" });
    expect(request!.link_ciphertext).not.toContain(bookingId);
    expect(request!.expires_at.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    const [review] = await db<{ base_revision: number; patch: Record<string, unknown>; state: string }[]>`
      select base_revision, patch, state from app.request_reviews where request_id = ${request!.id}
    `;
    expect(review).toEqual({ base_revision: 1, patch: { durationMinutes: 45, purpose: "Research collaboration" }, state: "pending" });

    const [intake] = await db<{ closed: boolean; request_id: string }[]>`
      select request_id, closed_at is not null as closed from app.intakes where id = ${intakeId}
    `;
    expect(intake).toEqual({ closed: true, request_id: request!.id });

    const [discussion] = await db<{ audience: string; id: string }[]>`
      select id, audience from app.discussions where principal_type = 'requester_request' and principal_id = ${request!.id}
    `;
    expect(discussion!.audience).toBe("requester");
    const inputs = await db<{ message: string; state: string }[]>`
      select message, state from app.conversation_inputs where discussion_id = ${discussion!.id}
    `;
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.message).toMatch(/^Intake summary from the public page/);
    expect(inputs[0]!.message).toContain("Research collaboration");
    expect(inputs[0]!.message).not.toContain(email);

    const deliveries = await db<{ kind: string; recipients: string[] }[]>`
      select kind, recipients from app.email_deliveries where request_id = ${request!.id}
    `;
    expect(deliveries).toEqual([{ kind: "request_creation", recipients: [email] }]);
    const [outcome] = await db<{ result: unknown }[]>`
      select result from app.command_outcomes where actor = ${`public_intake:${intakeId}`}
    `;
    expect(JSON.stringify(outcome!.result)).not.toContain(bookingId);

    // The continued intake takes no more messages.
    const after = await message(deps, host.handle, "One more thing", { token });
    expect(after.status).toBe(409);
    expect(await after.json()).toMatchObject({ code: "closed", continued: true });
  });

  it("returns the same link on an exact retry without charging a bound, and creates at most one request per intake", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db);
    const { token } = await startedIntake(deps, host.handle);
    const body = { email: uniqueEmail(), language: "en", name: "Grace Hopper", timezone: "Asia/Seoul" };

    const [first, second] = await Promise.all([continueWithout(deps, host.handle, token, body), continueWithout(deps, host.handle, token, body)]);
    const links = await Promise.all([first.json(), second.json()]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(links[0].bookingId).toBe(links[1].bookingId);

    const changed = await continueWithout(deps, host.handle, token, { ...body, name: "Someone else" });
    expect(changed.status).toBe(409);

    const [counts] = await db<{ creations: number; requests: number }[]>`
      select (select count(*)::int from app.requests where host_account_id = ${host.hostAccountId}) as requests,
             (select count(*)::int from app.request_creations where host_account_id = ${host.hostAccountId}) as creations
    `;
    expect(counts).toEqual({ creations: 1, requests: 1 });
  });

  it("bounds creation to 5 per source an hour, 20 a day and 500 across the service a day", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db, { creationLimits: { serviceDay: Number.POSITIVE_INFINITY } });
    const source = sourceAddress();
    const tokens: string[] = [];

    // Intakes come from other addresses, so only the creation bound is tested.
    for (let index = 0; index < 6; index += 1) tokens.push((await startedIntake(deps, host.handle)).token);
    for (const token of tokens.slice(0, 5)) expect((await continueWithout(deps, host.handle, token, undefined, source)).status).toBe(201);

    const sixth = await continueWithout(deps, host.handle, tokens[5], undefined, source);
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ code: "rate_limited", error: "Too many requests from your network right now. Try again later." });
    const [open] = await db<{ open: boolean }[]>`
      select closed_at is null as open from app.intakes where token_hash = ${hashIntakeToken(tokens[5]!)}
    `;
    expect(open!.open).toBe(true);

    // A day's worth from one source, older than an hour.
    const daily = sourceAddress();
    await db`update app.request_creations set created_at = now() - interval '2 hours' where host_account_id = ${host.hostAccountId}`;
    const [hash] = await db<{ source_hash: string }[]>`
      select source_hash from app.request_creations where host_account_id = ${host.hostAccountId} limit 1
    `;
    await db`
      insert into app.request_creations (source_hash, host_account_id, created_at)
      select ${hash!.source_hash}, ${host.hostAccountId}, now() - interval '3 hours' from generate_series(1, 15)
    `;
    expect((await continueWithout(deps, host.handle, tokens[5], undefined, source)).status).toBe(429);
    expect((await continueWithout(deps, host.handle, tokens[5], undefined, daily)).status).toBe(201);

    // The service bound, with the day's count as the limit.
    const [service] = await db<{ count: number }[]>`
      select count(*)::int as count from app.request_creations where created_at > now() - interval '24 hours'
    `;
    const full = guestDependencies(db, { creationLimits: { perSourceDay: 100, perSourceHour: 100, serviceDay: service!.count } });
    const last = await startedIntake(full, host.handle);
    expect((await continueWithout(full, host.handle, last.token)).status).toBe(429);
    expect(CREATION_LIMITS).toEqual({ perSourceDay: 20, perSourceHour: 5, serviceDay: 500 });
  });
});
