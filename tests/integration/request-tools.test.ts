import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_MATCH_MESSAGE } from "../../lib/contracts/feasibility";
import { EVALUATION_JOB } from "../../lib/server/evaluation";
import { closeRequest } from "../../lib/server/request-lifecycle";
import { applyReviewCommand } from "../../lib/server/request-reviews";
import {
  draftRequestReviewForTool,
  evaluateCandidatesForTool,
  readBookingStatusForTool,
  readRequestForTool,
  RequestToolDeniedError,
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
  google = await startFakeGoogle();
});

afterAll(async () => {
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
    expect(text).not.toMatch(/buffer|weeklyWindows|conflictCalendars|example\.test/i);

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
