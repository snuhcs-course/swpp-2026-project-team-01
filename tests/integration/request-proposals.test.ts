import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenRequesterView } from "../../lib/contracts/requester-view";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { EVALUATION_JOB } from "../../lib/server/evaluation";
import { agreeCommand, allowTripCommand, chooseCandidateCommand } from "../../lib/server/request-proposals";
import { createRequesterCommandHandler, createRequesterStateHandler } from "../../lib/server/requester-routes";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { call, guestDependencies } from "./support/guests";
import {
  asRequester,
  busy,
  evaluationDeps,
  revisionOf,
  runEvaluation,
  seedSchedulingRequest,
  seoul,
} from "./support/scheduling";

// Candidates, proposals and agreement on the booking page (task 6.3, and task
// 4.3's agreement with an unconfirmed address): the card commands through the
// requester command route while the model is unavailable, the authored
// no-match outcome, the link plan, immutable proposal versions, and agreement
// only to the current version while its start is in the future and the request
// open.

const db = testDatabase();
let google: FakeGoogle;

// The model and the agent are unavailable: nothing here may need them.
const unavailableRuntime: ConversationRuntime = {
  createSession: async () => {
    throw new Error("The agent is unavailable.");
  },
  readEvents: () => {
    throw new Error("The agent is unavailable.");
  },
  readRecordedEvents: () => {
    throw new Error("The agent is unavailable.");
  },
  sendMessage: async () => {
    throw new Error("The agent is unavailable.");
  },
};
const deps = guestDependencies(db, { runtime: unavailableRuntime });

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

type Outcome = { ok: boolean; result?: Record<string, unknown>; error?: { category: string; reason?: string }; status?: string };

async function command(bookingId: string, operation: string, input: unknown, expectedRevision: number | null, retryKey = randomUUID()) {
  const response = await call(createRequesterCommandHandler(() => deps), { bookingId }, `/api/requests/${bookingId}/commands`, {
    body: { expectedRevision, input, operation, retryKey },
  });
  return (await response.json()) as Outcome;
}

async function view(bookingId: string) {
  const response = await call(createRequesterStateHandler(() => deps), { bookingId }, "/state");
  return (await response.json()) as OpenRequesterView;
}

// Find times on the card, with the job run through the real handler.
async function findTimes(bookingId: string) {
  const outcome = await command(bookingId, "request.evaluate", {}, null);
  expect(outcome.ok).toBe(true);
  const evaluationId = outcome.result!.evaluationId as string;
  await runEvaluation(db, evaluationDeps(db, google), evaluationId);
  return evaluationId;
}

async function agreements(requestId: string) {
  return db<{ request_revision: number; version: number }[]>`
    select a.request_revision, p.version from app.agreements a join app.proposals p on p.id = a.proposal_id
    where p.request_id = ${requestId}
  `;
}

describe("scheduling from the cards without the model", () => {
  it("saves details, finds times, chooses one and agrees, with the contact still unconfirmed", async () => {
    const r = await seedSchedulingRequest(db, google, {
      details: { durationMinutes: null, mode: null, purpose: null, windows: [] },
      events: [busy("10:00", "10:30")],
    });

    const saved = await command(
      r.bookingId,
      "request.update_details",
      { details: { durationMinutes: 30, mode: "online", purpose: "Intro call", windows: [{ date: seoul("10:00").slice(0, 10), end: "11:00", start: "10:00" }] }, timezone: "Asia/Seoul" },
      1,
    );
    expect(saved).toMatchObject({ ok: true, result: { revision: 2, state: "gathering" } });

    const evaluationId = await findTimes(r.bookingId);
    let current = await view(r.bookingId);
    expect(current.request.state).toBe("negotiating");
    expect(current.evaluation).toMatchObject({ id: evaluationId, meetAvailable: true, state: "completed" });
    const [candidate] = current.evaluation!.candidates;
    expect(candidate).toMatchObject({ end: seoul("11:00"), start: seoul("10:30") });

    const chosen = await command(r.bookingId, "request.choose_candidate", { candidateId: candidate!.id, evaluationId }, 2);
    expect(chosen).toMatchObject({ ok: true, result: { outcome: "proposed", version: 1 } });
    current = await view(r.bookingId);
    expect(current.proposal).toMatchObject({
      displayTimezones: ["Asia/Seoul"],
      durationMinutes: 30,
      linkPlan: { kind: "google_meet" },
      mode: "online",
      start: seoul("10:30"),
      version: 1,
    });

    const agreed = await command(r.bookingId, "request.agree", { version: 1 }, 2);
    expect(agreed).toMatchObject({ ok: true, result: { revision: 3, state: "awaiting_host_approval", version: 1 } });
    expect(await agreements(r.requestId)).toEqual([{ request_revision: 2, version: 1 }]);

    // Task 4.3: agreement goes ahead with an unconfirmed address, and the
    // request record the host reads shows the contact unconfirmed.
    const [record] = await db<{ contact_confirmed_email: string | null; state: string }[]>`
      select state, contact_confirmed_email from app.requests where id = ${r.requestId}
    `;
    expect(record).toEqual({ contact_confirmed_email: null, state: "awaiting_host_approval" });
    current = await view(r.bookingId);
    expect(current.contact.confirmed).toBe(false);
    expect(current.agreement).toMatchObject({ proposalVersion: 1 });
  });

  it("shows the authored no-match outcome and creates no proposal", async () => {
    const r = await seedSchedulingRequest(db, google, { events: [busy("09:00", "12:00")] });
    await findTimes(r.bookingId);

    const current = await view(r.bookingId);

    expect(current.evaluation).toMatchObject({ candidates: [], failure: null, state: "completed" });
    expect(current.request.state).toBe("gathering");
    expect(current.proposal).toBeNull();
  });
});

describe("the link plan", () => {
  it("asks for a meeting link instead of proposing when the destination has no Google Meet", async () => {
    const r = await seedSchedulingRequest(db, google, { conferenceSolutionTypes: [] });
    const evaluationId = await findTimes(r.bookingId);
    const current = await view(r.bookingId);
    expect(current.evaluation!.meetAvailable).toBe(false);

    const chosen = await command(r.bookingId, "request.choose_candidate", { candidateId: current.evaluation!.candidates[0]!.id, evaluationId }, 1);

    expect(chosen).toMatchObject({ ok: true, result: { outcome: "needs_meeting_link" } });
    expect((await view(r.bookingId)).proposal).toBeNull();
  });

  it("puts the requester's own https link in the proposal", async () => {
    const r = await seedSchedulingRequest(db, google, {
      conferenceSolutionTypes: [],
      details: { linkPlan: { kind: "requester_link", url: "https://meet.example.test/grace" } },
    });
    const evaluationId = await findTimes(r.bookingId);
    const current = await view(r.bookingId);

    await command(r.bookingId, "request.choose_candidate", { candidateId: current.evaluation!.candidates[0]!.id, evaluationId }, 1);

    expect((await view(r.bookingId)).proposal!.linkPlan).toEqual({ kind: "requester_link", url: "https://meet.example.test/grace" });
  });
});

describe("agreement guards", () => {
  async function proposed(versions = 1) {
    const r = await seedSchedulingRequest(db, google);
    const evaluationId = await findTimes(r.bookingId);
    const { candidates } = (await view(r.bookingId)).evaluation!;
    for (let index = 0; index < versions; index += 1) {
      await command(r.bookingId, "request.choose_candidate", { candidateId: candidates[index]!.id, evaluationId }, 1);
    }
    return r;
  }

  it("rejects agreement to a superseded version with no decision on the newer one", async () => {
    const r = await proposed(2);

    const agreed = await command(r.bookingId, "request.agree", { version: 1 }, 1);

    expect(agreed).toMatchObject({ error: { category: "stale_revision", reason: "proposal_superseded" }, ok: false });
    expect(await agreements(r.requestId)).toEqual([]);
    expect((await view(r.bookingId)).proposal!.version).toBe(2);
  });

  it("rejects agreement once the details changed after the proposal", async () => {
    const r = await proposed();
    await command(r.bookingId, "request.update_details", { details: { purpose: "A different meeting" }, timezone: "Asia/Seoul" }, 1);

    const agreed = await command(r.bookingId, "request.agree", { version: 1 }, 2);

    expect(agreed).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect((await view(r.bookingId)).proposal).toBeNull();
    expect((await view(r.bookingId)).request.state).toBe("gathering");
  });

  it("rejects agreement after the request closed", async () => {
    const r = await proposed();
    await command(r.bookingId, "request.withdraw", {}, 1);

    const agreed = await command(r.bookingId, "request.agree", { version: 1 }, 2);

    expect(agreed).toMatchObject({ error: { category: "request_closed" }, ok: false, status: "withdrawn" });
    expect(await agreements(r.requestId)).toEqual([]);
  });

  it("rejects a proposal whose start passed while agreement waited for the lock", async () => {
    const r = await seedSchedulingRequest(db, google);
    await db`update app.requests set state = 'negotiating' where id = ${r.requestId}`;
    const start = new Date(Date.now() + 2_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const [evaluation] = await db<{ id: string }[]>`
      insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at, candidates, requester_projection)
      values (${r.requestId}, 1, 1, 'completed', now(), '[]'::jsonb, '{"candidates":[]}'::jsonb)
      returning id
    `;
    await db`
      insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
      values (${r.requestId}, 1, ${evaluation!.id}, 'c-soon', ${start}, ${end},
              ${db.json({ displayTimezones: ["Asia/Seoul"], durationMinutes: 30, end: end.toISOString(), linkPlan: { kind: "google_meet" }, location: null, mode: "online", participants: [], start: start.toISOString() })})
    `;

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.begin(async (tx) => {
      await tx`select id from app.requests where id = ${r.requestId} for update`;
      locked();
      await held;
    });
    await lockTaken;
    const agreeing = asRequester(db, r.requestId, agreeCommand, { version: 1 }, { expectedRevision: 1 });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    release();
    await holder;

    expect(await agreeing).toMatchObject({ error: { category: "invalid_input", reason: "start_passed" }, ok: false });
    expect(await agreements(r.requestId)).toEqual([]);
  });

  it("refuses a candidate while the duration is still unknown", async () => {
    const r = await seedSchedulingRequest(db, google, { details: { durationMinutes: null } });
    const evaluationId = await findTimes(r.bookingId);
    const { candidates } = (await view(r.bookingId)).evaluation!;

    const chosen = await asRequester(db, r.requestId, chooseCandidateCommand, { candidateId: candidates[0]!.id, evaluationId }, { expectedRevision: 1 });

    expect(chosen).toMatchObject({ error: { category: "invalid_input" }, ok: false });
  });
});

describe("a requester trip allowance", () => {
  it("records the requester's allowance for the unresolved leg and evaluates again", async () => {
    const r = await seedSchedulingRequest(db, google, { details: { location: "Cafe Onion, Seongsu", mode: "in_person", travelMode: "transit" } });
    await db`update app.requests set state = 'negotiating' where id = ${r.requestId}`;
    const candidate = { end: seoul("11:00"), id: "c-trip", start: seoul("10:30") };
    const leg = {
      departure: seoul("10:00"),
      destinationKey: "destination-key",
      direction: "inbound",
      gapMinutes: 30,
      mode: "transit",
      originKey: "origin-key",
      party: "requester",
      source: null,
      status: "unresolved",
      travelMinutes: null,
      unresolvedReason: "no_route",
    };
    const [evaluation] = await db<{ id: string }[]>`
      insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at, candidates, requester_projection)
      values (${r.requestId}, 1, 1, 'completed', now(),
              ${db.json([{ ...candidate, basis: [], belowWeeklyLimit: true, durationMinutes: 30, legs: [leg], linkPlan: null, location: "Cafe Onion, Seongsu", mode: "in_person", status: "requester_unresolved", weekCount: 0, weekStart: seoul("00:00") }])},
              ${db.json({ candidates: [{ ...candidate, displayTimezone: "Asia/Seoul", durationMinutes: 30, linkPlan: null, location: "Cafe Onion, Seongsu", mode: "in_person", unresolvedRequesterLeg: "inbound" }], failure: null, id: "x", meetAvailable: null, state: "completed" })})
      returning id
    `;

    const chosen = await asRequester(db, r.requestId, chooseCandidateCommand, { candidateId: "c-trip", evaluationId: evaluation!.id }, { expectedRevision: 1 });
    expect(chosen).toMatchObject({ error: { category: "invalid_input" }, ok: false });

    const allowed = await asRequester(db, r.requestId, allowTripCommand, { candidateId: "c-trip", evaluationId: evaluation!.id, minutes: 25 });

    expect(allowed.ok).toBe(true);
    const [allowance] = await db<Record<string, unknown>[]>`
      select party, confirmed_by, direction, origin_hash, destination_hash, mode, minutes, candidate_start
      from app.travel_allowances where request_id = ${r.requestId}
    `;
    expect(allowance).toEqual({
      candidate_start: new Date(candidate.start),
      confirmed_by: "requester",
      destination_hash: "destination-key",
      direction: "inbound",
      minutes: 25,
      mode: "transit",
      origin_hash: "origin-key",
      party: "requester",
    });
    const [job] = await db<{ count: number }[]>`
      select count(*)::int as count from app.jobs
      where kind = ${EVALUATION_JOB} and payload ->> 'evaluationId' = ${(allowed as { result: { evaluationId: string } }).result.evaluationId}
    `;
    expect(job!.count).toBe(1);
    expect(await revisionOf(db, r.requestId)).toBe(1);
  });
});
