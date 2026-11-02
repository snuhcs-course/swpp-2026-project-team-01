import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NO_MATCH_MESSAGE } from "../../lib/contracts/feasibility";
import { EVALUATION_JOB } from "../../lib/server/evaluation";
import { closeRequest } from "../../lib/server/request-lifecycle";
import { applyReviewCommand } from "../../lib/server/request-reviews";
import {
  agreeToProposalForTool,
  changeAgreementForTool,
  chooseTimeForTool,
  draftRequestReviewForTool,
  evaluateCandidatesForTool,
  readBookingStatusForTool,
  readRequestForTool,
  RequestToolDeniedError,
  withdrawRequestForTool,
} from "../../lib/server/request-tools";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { ORIGIN } from "./support/guests";
import { testTokenKey } from "./support/requests";
import {
  asRequester,
  busy,
  evaluationDeps,
  indexRequesterSession,
  runEvaluation,
  seedSchedulingRequest,
} from "./support/scheduling";

// The requester tools (task 6.1; design decision 12): the fence (open request,
// unexpired link, the discussion's current generation), the actor from the
// session principal, `tool:{callId}` retries through runCommand, contact
// minimization and the requester projection only. evaluate_candidates publishes
// the evaluation job and waits for it; here the job runs through the real
// handler against the fake Google while the tool waits.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", testTokenKey.key.toString("base64"));
  google = await startFakeGoogle();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await google.close();
  await db.end();
});

async function requester(options: Parameters<typeof seedSchedulingRequest>[2] = {}) {
  const request = await seedSchedulingRequest(db, google, options);
  const session = await indexRequesterSession(db, request.requestId);
  return { ...request, call: (callId = randomUUID()) => ({ auth: session.auth, callId, sessionId: session.sessionId }), session };
}

async function evaluationJobFor(requestId: string, callId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [job] = await db<{ evaluation_id: string }[]>`
      select payload ->> 'evaluationId' as evaluation_id from app.jobs
      where kind = ${EVALUATION_JOB} and dedupe_key = ${`${EVALUATION_JOB}:${requestId}:tool:${callId}`}
    `;
    if (job) return job.evaluation_id;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("No evaluation job was published.");
}

describe("the fence", () => {
  it("denies a retired generation, a closed request and another audience", async () => {
    const r = await requester();
    const old = r.call();
    await indexRequesterSession(db, r.requestId);

    await expect(readRequestForTool(db, old)).rejects.toBeInstanceOf(RequestToolDeniedError);

    const current = await requester();
    const intakeAuth = { ...current.session.auth!, attributes: { ...current.session.auth!.attributes, audience: "public_intake" } };
    await expect(readRequestForTool(db, { ...current.call(), auth: intakeAuth })).rejects.toBeInstanceOf(RequestToolDeniedError);

    // Another request's principal with this session finds nothing either.
    const other = await requester();
    await expect(readRequestForTool(db, { ...current.call(), auth: other.session.auth })).rejects.toBeInstanceOf(RequestToolDeniedError);

    await db.begin((tx) => closeRequest(tx, current.requestId, "withdrawn"));
    await expect(readRequestForTool(db, current.call())).rejects.toBeInstanceOf(RequestToolDeniedError);
    await expect(draftRequestReviewForTool(db, current.call(), { details: { purpose: "x" }, intent: "details" })).rejects.toBeInstanceOf(
      RequestToolDeniedError,
    );
  });

  it("recovers a committed draft on replay of the same call, even after the review was applied", async () => {
    const r = await requester();
    const call = r.call();
    const input = { details: { purpose: "Pair programming" }, intent: "details" as const };
    const first = await draftRequestReviewForTool(db, call, input);
    const [review] = await db<{ id: string }[]>`select id from app.request_reviews where request_id = ${r.requestId}`;
    await asRequester(db, r.requestId, applyReviewCommand({ origin: ORIGIN, tokenKey: testTokenKey }), { reviewId: review!.id }, {
      expectedRevision: 1,
    });

    const replay = await draftRequestReviewForTool(db, call, input);

    expect(replay).toEqual(first);
    const [count] = await db<{ count: number }[]>`select count(*)::int as count from app.request_reviews where request_id = ${r.requestId}`;
    expect(count!.count).toBe(1);
  });
});

describe("read_request and read_booking_status", () => {
  it("returns the requester projection with contact presence and no host context", async () => {
    const r = await requester({ settings: { bufferBeforeMinutes: 25, displayName: "Ada <b>Lovelace</b>" } });
    const projection = await readRequestForTool(db, r.call());
    const text = JSON.stringify(projection);

    expect(projection).toMatchObject({
      contact: { email: "present", name: "present" },
      details: { durationMinutes: 30, mode: "online", purpose: "Talk about compilers", timezone: "Asia/Seoul" },
      readyForTimes: true,
      status: { state: "gathering" },
    });
    expect(text).not.toContain(r.contactEmail);
    expect(text).not.toContain("Grace Hopper");
    expect(text).not.toMatch(/buffer|conflictCalendars|example\.test/i);
    expect(projection.details).not.toHaveProperty("weeklyWindows");
    expect(projection.host).not.toHaveProperty("weeklyWindows");

    expect(await readBookingStatusForTool(db, r.call())).toMatchObject({ agreedVersion: null, proposalVersion: null, state: "gathering" });
  });
});

describe("evaluate_candidates", () => {
  it("publishes the evaluation job and returns the requester projection once it completes", async () => {
    const r = await requester({ events: [busy("10:00", "10:30")] });
    const call = r.call();
    const waiting = evaluateCandidatesForTool(db, call, { waitMs: 10_000 });
    const evaluationId = await evaluationJobFor(r.requestId, call.callId);
    await runEvaluation(db, evaluationDeps(db, google), evaluationId);

    const result = await waiting;

    expect(result).toMatchObject({ evaluated: true, evaluationId, message: null, state: "completed" });
    expect((result as { candidates: { id: string; time: string }[] }).candidates.map((candidate) => candidate.time)).toEqual([
      expect.stringMatching(/10:30 GMT\+9 to .*11:00 GMT\+9$/),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/basis|legs|weekCount|busy/i);
  });

  it("returns the evaluation's identity while it is still running", async () => {
    const r = await requester();
    const result = await evaluateCandidatesForTool(db, r.call(), { waitMs: 300 });

    expect(result).toMatchObject({ candidates: [], evaluated: true, state: "pending" });
    expect((result as { evaluationId: string }).evaluationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives the authored no-match message with no rule or reason when nothing fits", async () => {
    const r = await requester({ events: [busy("09:00", "12:00")] });
    const call = r.call();
    const waiting = evaluateCandidatesForTool(db, call, { waitMs: 10_000 });
    await runEvaluation(db, evaluationDeps(db, google), await evaluationJobFor(r.requestId, call.callId));

    const result = await waiting;

    expect(result).toMatchObject({ candidates: [], message: NO_MATCH_MESSAGE.en, state: "completed" });
    expect(JSON.stringify(result)).not.toMatch(/busy|rule|buffer/i);
  });
  it("reuses a pending evaluation and bounds new ones to 10 per request per hour", async () => {
    const r = await requester();
    const first = (await evaluateCandidatesForTool(db, r.call(), { waitMs: 50 })) as { evaluationId: string };
    const again = (await evaluateCandidatesForTool(db, r.call(), { waitMs: 50 })) as { evaluationId: string };
    expect(again.evaluationId).toBe(first.evaluationId);

    // Nine more finished evaluations in the last hour make ten.
    await db`update app.evaluations set state = 'failed', completed_at = now() where id = ${first.evaluationId}`;
    await db`
      insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at)
      select request_id, request_revision, settings_revision, 'failed', now()
      from app.evaluations, generate_series(1, 9) where id = ${first.evaluationId}
    `;

    expect(await evaluateCandidatesForTool(db, r.call(), { waitMs: 50 })).toEqual({
      evaluated: false,
      message: "Times were looked up too often in the last hour. Try again later.",
    });
    const [count] = await db<{ count: number }[]>`select count(*)::int as count from app.evaluations where request_id = ${r.requestId}`;
    expect(count!.count).toBe(10);
  });
});

describe("decisions in words (U15)", () => {
  async function withTimes() {
    const r = await requester({ details: { linkPlan: { kind: "google_meet" } }, events: [busy("10:00", "10:30")] });
    const call = r.call();
    const waiting = evaluateCandidatesForTool(db, call, { waitMs: 10_000 });
    await runEvaluation(db, evaluationDeps(db, google), await evaluationJobFor(r.requestId, call.callId));
    const result = (await waiting) as { candidates: { id: string }[] };
    return { ...r, candidateId: result.candidates[0]!.id };
  }

  it("chooses a named time, agrees to its proposal, reopens it, and withdraws", async () => {
    const r = await withTimes();

    expect(await agreeToProposalForTool(db, r.call(), { version: 1 })).toMatchObject({ recorded: false });
    expect(await chooseTimeForTool(db, r.call(), { candidateId: r.candidateId })).toMatchObject({ recorded: true, state: "negotiating" });
    expect(await agreeToProposalForTool(db, r.call(), { version: 1 })).toMatchObject({ recorded: true, state: "awaiting_host_approval" });
    expect(await readBookingStatusForTool(db, r.call())).toMatchObject({ agreedVersion: 1, state: "awaiting_host_approval" });

    expect(await changeAgreementForTool(db, r.call())).toMatchObject({ recorded: true, state: "negotiating" });
    expect(await changeAgreementForTool(db, r.call())).toMatchObject({ recorded: false });

    expect(await withdrawRequestForTool(db, r.call())).toMatchObject({ recorded: true, state: "withdrawn" });
    await expect(readRequestForTool(db, r.call())).rejects.toBeInstanceOf(RequestToolDeniedError);
  });

  it("replays a decision on the same call instead of repeating it", async () => {
    const r = await withTimes();
    const call = r.call();
    const first = await chooseTimeForTool(db, call, { candidateId: r.candidateId });
    expect(await chooseTimeForTool(db, call, { candidateId: r.candidateId })).toEqual(first);
    const [count] = await db<{ count: number }[]>`select count(*)::int as count from app.proposals where request_id = ${r.requestId}`;
    expect(count!.count).toBe(1);
  });
});

describe("a booked request (U18)", () => {
  it("can be read with its meeting, and refuses decisions", async () => {
    const r = await requester();
    await db`update app.requests set state = 'booked', closed_at = now() where id = ${r.requestId}`;

    expect(await readRequestForTool(db, r.call())).toMatchObject({ booking: null, status: { state: "booked" } });
    expect(await readBookingStatusForTool(db, r.call())).toMatchObject({ state: "booked" });
    await expect(withdrawRequestForTool(db, r.call())).rejects.toBeInstanceOf(RequestToolDeniedError);
  });
});


describe("draft_request_review on a revised request (U17)", () => {
  it("refuses a time wholly inside the host's excluded times, with no reason", async () => {
    const r = await requester();
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
    const excluded = { end: day(9).toISOString(), start: day(5).toISOString() };
    await db`update app.requests set details = details || ${db.json({ excludedTimes: [excluded] })} where id = ${r.requestId}`;
    const local = (offset: number) => ({ date: day(offset).toISOString().slice(0, 10), end: "11:00", start: "10:00" });

    const refused = await draftRequestReviewForTool(db, r.call(), { details: { windows: [local(7)] }, intent: "availability" });
    expect(refused).toMatchObject({ problem: "excluded_window", recorded: false });
    expect(JSON.stringify(refused)).not.toMatch(/busy|rule|event|note/i);

    expect(
      await draftRequestReviewForTool(db, r.call(), { details: { windows: [local(20)] }, intent: "availability" }, { waitMs: 50 }),
    ).toMatchObject({ recorded: true });
  });
});

describe("draft_request_review with only the guest's days (U21)", () => {
  const date = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const states = async (requestId: string) =>
    (await db<{ state: string }[]>`select state from app.request_reviews where request_id = ${requestId} order by created_at`).map(
      (review) => review.state,
    );

  it("applies days alone at once and finds times, once the meeting has its purpose, length and form", async () => {
    const r = await requester();
    const result = await draftRequestReviewForTool(
      db,
      r.call(),
      { details: { windows: [{ date: date(3), end: "23:59", start: "00:00" }] }, intent: "availability" },
      { waitMs: 50 },
    );

    expect(result).toMatchObject({ recorded: true });
    expect(await states(r.requestId)).toEqual(["applied"]);
    const [evaluations] = await db<{ count: number }[]>`select count(*)::int as count from app.evaluations where request_id = ${r.requestId}`;
    expect(evaluations!.count).toBe(1);
  });

  it("asks for confirmation before applying inferred afternoon availability", async () => {
    const r = await requester();
    const result = await draftRequestReviewForTool(db, r.call(), {
      details: { windows: [{ date: date(3), start: "12:00", end: "18:00" }] },
      inferredTime: true,
      intent: "availability",
    }, { waitMs: 50 });
    expect(result).toMatchObject({ recorded: true, review: { canApply: true } });
    expect(await states(r.requestId)).toEqual(["pending"]);
  });

  it("keeps preferred times separate from availability until the guest applies them", async () => {
    const r = await requester();
    const day = date(3);
    const result = await draftRequestReviewForTool(db, r.call(), {
      details: { windows: [{ date: day, start: "00:00", end: "23:59" }], preferredWindows: [{ date: day, start: "12:00", end: "18:00" }] },
      inferredTime: true,
      intent: "availability",
    }, { waitMs: 50 });
    expect(result).toMatchObject({ recorded: true, review: { canApply: true } });
    const [review] = await db<{ id: string }[]>`select id from app.request_reviews where request_id = ${r.requestId} and state = 'pending'`;
    const [before] = await db<{ details: { preferredWindows?: unknown }; revision: number }[]>`select details, revision from app.requests where id = ${r.requestId}`;
    expect(before!.details.preferredWindows).toBeUndefined();
    await asRequester(db, r.requestId, applyReviewCommand({ origin: ORIGIN, tokenKey: testTokenKey }), { reviewId: review!.id }, { expectedRevision: before!.revision });
    const [after] = await db<{ details: { windows: unknown[]; preferredWindows: unknown[] } }[]>`select details from app.requests where id = ${r.requestId}`;
    expect(after!.details.windows).toHaveLength(1);
    expect(after!.details.preferredWindows).toHaveLength(1);
  });

  it("applies an adjustment to existing preferred times without another review", async () => {
    const r = await requester();
    const day = date(3);
    const other = date(4);
    const original = [{ start: `${day}T00:00:00.000Z`, end: `${day}T03:00:00.000Z` }];
    await db`update app.requests set details = details || ${db.json({ preferredWindows: original })} where id = ${r.requestId}`;
    const [before] = await db<{ details: { windows: unknown[] } }[]>`select details from app.requests where id = ${r.requestId}`;
    const result = await draftRequestReviewForTool(db, r.call(), {
      details: { preferredWindows: [{ date: other, start: "09:00", end: "12:00" }] },
      intent: "availability",
    }, { waitMs: 50 });
    expect(result).toMatchObject({ recorded: true });
    expect(await states(r.requestId)).toEqual(["applied"]);
    const [after] = await db<{ details: { windows: unknown[]; preferredWindows: unknown[] } }[]>`select details from app.requests where id = ${r.requestId}`;
    expect(after!.details.windows).toEqual(before!.details.windows);
    expect(after!.details.preferredWindows).toHaveLength(1);
    expect(after!.details.preferredWindows).not.toEqual(original);
  });

  it("records a less preferred day without removing availability", async () => {
    const r = await requester();
    const [before] = await db<{ details: { windows: unknown[] } }[]>`select details from app.requests where id = ${r.requestId}`;
    await draftRequestReviewForTool(db, r.call(), { intent: "availability", details: { lessPreferredWindows: [{ date: date(3), start: "00:00", end: "23:59" }] } }, { waitMs: 50 });
    expect(await states(r.requestId)).toEqual(["applied"]);
    const [after] = await db<{ details: { windows: unknown[]; lessPreferredWindows: unknown[] } }[]>`select details from app.requests where id = ${r.requestId}`;
    expect(after!.details.windows).toEqual(before!.details.windows);
    expect(after!.details.lessPreferredWindows).toHaveLength(1);
  });

  it("saves recurring preferences for this request after confirmation and exposes them on reread", async () => {
    const r = await requester();
    const weekly = [{ weekday: "monday" as const, start: "12:00", end: "18:00" }];
    const result = await draftRequestReviewForTool(db, r.call(), { details: { preferredWeeklyWindows: weekly }, inferredTime: true, intent: "availability" });
    expect(result).toMatchObject({ recorded: true, review: { canApply: true } });
    expect((await readRequestForTool(db, r.call())).details.preferredWeeklyWindows).toEqual([]);
    const [review] = await db<{ id: string }[]>`select id from app.request_reviews where request_id = ${r.requestId} and state = 'pending'`;
    const [before] = await db<{ revision: number }[]>`select revision from app.requests where id = ${r.requestId}`;
    await asRequester(db, r.requestId, applyReviewCommand({ origin: ORIGIN, tokenKey: testTokenKey }), { reviewId: review!.id }, { expectedRevision: before!.revision });
    expect((await readRequestForTool(db, r.call())).details.preferredWeeklyWindows).toEqual(weekly);
  });

  it("leaves days with another detail, or before the meeting is complete, for the review card", async () => {
    const r = await requester();
    const withPurpose = await draftRequestReviewForTool(
      db,
      r.call(),
      { details: { purpose: "Talk about parsers", windows: [{ date: date(3), end: "12:00", start: "10:00" }] }, intent: "details" },
      { waitMs: 50 },
    );
    expect(withPurpose).toMatchObject({ recorded: true, review: { canApply: true } });
    expect(await states(r.requestId)).toEqual(["pending"]);

    const unsure = await requester({ details: { mode: null } });
    await draftRequestReviewForTool(db, unsure.call(), { details: { windows: [{ date: date(3), end: "12:00", start: "10:00" }] }, intent: "availability" }, { waitMs: 50 });
    expect(await states(unsure.requestId)).toEqual(["pending"]);
  });
});
