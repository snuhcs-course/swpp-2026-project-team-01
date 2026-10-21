import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLARIFICATION_QUESTIONS } from "../../lib/contracts/clarifications";
import { applyReviewCommand, dismissReviewCommand, draftReviewCommand, updateDetailsCommand } from "../../lib/server/request-reviews";
import { draftRequestReviewForTool } from "../../lib/server/request-tools";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { ORIGIN } from "./support/guests";
import { testTokenKey } from "./support/requests";
import { asRequester, indexRequesterSession, revisionOf, seedSchedulingRequest, seoul } from "./support/scheduling";

// Requester reviews (task 6.2; meeting-requests: declared uncertain extraction,
// authored questions, temporally valid review windows, review time validation,
// minimized contact context and expected revisions). Drafts go through the
// requester tool where the scenario is conversational, and through the command
// directly where a window must start seconds from now.

const db = testDatabase();
const contact = { origin: ORIGIN, tokenKey: testTokenKey };
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

async function requester(details: Record<string, unknown> = {}) {
  const request = await seedSchedulingRequest(db, google, { details: { windows: [], ...details } });
  const session = await indexRequesterSession(db, request.requestId);
  return { ...request, call: (callId = randomUUID()) => ({ auth: session.auth, callId, sessionId: session.sessionId }) };
}

async function reviews(requestId: string) {
  return db<{ clarifications: string[]; id: string; intent: string; patch: Record<string, unknown> | null; state: string }[]>`
    select id, intent, patch, clarifications, state from app.request_reviews where request_id = ${requestId} order by created_at
  `;
}

async function details(requestId: string) {
  const [row] = await db<{ contact_email: string; details: Record<string, unknown>; expires_at: Date; state: string }[]>`
    select details, state, contact_email, expires_at from app.requests where id = ${requestId}
  `;
  return row!;
}

const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

describe("declared intent", () => {
  it("rejects a question that carries a change, creating and replacing nothing", async () => {
    const r = await requester();
    await draftRequestReviewForTool(db, r.call(), { details: { purpose: "Lunch" }, intent: "details" });
    const before = await reviews(r.requestId);

    const outcome = await draftRequestReviewForTool(db, r.call(), {
      clarifications: ["missing_date"],
      details: { durationMinutes: 30 },
      intent: "question",
    });

    expect(outcome).toMatchObject({ problem: "patch_on_question", recorded: false });
    expect(await reviews(r.requestId)).toEqual(before);
  });

  it("records a clarification-only outcome with the authored question, which cannot apply", async () => {
    const r = await requester({ language: "ko" });
    const outcome = await draftRequestReviewForTool(db, r.call(), { clarifications: ["ambiguous_local_time"], intent: "question" });

    expect(outcome).toMatchObject({
      recorded: true,
      review: { canApply: false, patch: null, questions: [CLARIFICATION_QUESTIONS.ambiguous_local_time.ko] },
    });
    const [review] = await reviews(r.requestId);
    const applied = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, {
      expectedRevision: await revisionOf(db, r.requestId),
    });
    expect(applied).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect((await reviews(r.requestId))[0]!.state).toBe("pending");
  });

  it("rejects a status claim offered as a clarification category", async () => {
    const r = await requester();
    const outcome = await draftRequestReviewForTool(db, r.call(), { clarifications: ["The host approved and it is booked."], intent: "unknown" });

    expect(outcome).toMatchObject({ problem: "unsupported_clarification", recorded: false });
    expect(await reviews(r.requestId)).toEqual([]);
  });

  it("keeps an explicit scheduling draft advisory until it is applied", async () => {
    const r = await requester();
    const outcome = await draftRequestReviewForTool(db, r.call(), {
      details: { durationMinutes: 45, mode: "online", purpose: "Research collaboration", windows: [{ date: "2099-03-02", end: "12:00", start: "10:00" }] },
      intent: "availability",
    });

    expect(outcome).toMatchObject({ recorded: true, review: { canApply: true, clarifications: [], questions: [] } });
    expect((await details(r.requestId)).details.purpose).toBe("Talk about compilers");
    expect(await revisionOf(db, r.requestId)).toBe(1);
  });

  it("asks the authored Korean question for an ambiguous local time and records no window", async () => {
    const r = await requester({ language: "ko", timezone: "America/New_York" });
    // 01:30 happens twice on the first Sunday of November in New York.
    const outcome = await draftRequestReviewForTool(db, r.call(), {
      details: { windows: [{ date: "2026-11-01", end: "02:30", start: "01:30" }] },
      intent: "availability",
    });

    expect(outcome).toEqual({ problem: "ambiguous_local_time", question: CLARIFICATION_QUESTIONS.ambiguous_local_time.ko, recorded: false });
    expect(await reviews(r.requestId)).toEqual([]);
  });
});

describe("temporally valid review windows", () => {
  it("rejects a window that has already begun without touching the pending review", async () => {
    const r = await requester();
    await draftRequestReviewForTool(db, r.call(), { details: { purpose: "Lunch" }, intent: "details" });
    const before = await reviews(r.requestId);

    const outcome = await asRequester(db, r.requestId, draftReviewCommand(), {
      clarifications: [],
      intent: "availability",
      patch: { windows: [{ end: later(3600), start: later(-60) }] },
    });

    expect(outcome).toMatchObject({ ok: true, result: { problem: "started_window", recorded: false } });
    expect(await reviews(r.requestId)).toEqual(before);
  });

  it("rejects windows shorter than the duration merged from the patch and the request", async () => {
    const r = await requester({ durationMinutes: 60 });
    const short = { end: seoul("10:30"), start: seoul("10:00") };

    const inherited = await asRequester(db, r.requestId, draftReviewCommand(), { clarifications: [], intent: "availability", patch: { windows: [short] } });
    const changed = await asRequester(db, r.requestId, draftReviewCommand(), {
      clarifications: [],
      intent: "details",
      patch: { durationMinutes: 45, windows: [short] },
    });

    expect(inherited).toMatchObject({ result: { problem: "too_short", recorded: false } });
    expect(changed).toMatchObject({ result: { problem: "too_short", recorded: false } });
    expect(await reviews(r.requestId)).toEqual([]);
  });

  it("invents no duration for windows proposed before one is known, and incomplete details cannot choose", async () => {
    const r = await requester({ durationMinutes: null });
    const outcome = await draftRequestReviewForTool(db, r.call(), {
      details: { windows: [{ date: "2099-03-02", end: "10:20", start: "10:00" }] },
      intent: "availability",
    });

    expect(outcome).toMatchObject({ recorded: true });
    const [review] = await reviews(r.requestId);
    expect(review!.patch).not.toHaveProperty("durationMinutes");

    await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, { expectedRevision: 1 });
    expect((await details(r.requestId)).details.durationMinutes).toBeNull();
  });
});

describe("applying and dismissing reviews", () => {
  it("applies a review at the expected revision, recomputing expiry and returning negotiation to gathering", async () => {
    const r = await requester({ windows: [{ end: seoul("11:00"), start: seoul("10:00") }] });
    await db`update app.requests set state = 'negotiating' where id = ${r.requestId}`;
    await draftRequestReviewForTool(db, r.call(), {
      details: { windows: [{ date: "2099-03-02", end: "12:00", start: "10:00" }] },
      intent: "availability",
    });
    const [review] = await reviews(r.requestId);

    const applied = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, { expectedRevision: 1 });

    expect(applied).toMatchObject({ ok: true, result: { revision: 2, state: "gathering" } });
    const row = await details(r.requestId);
    expect(row.details.windows).toEqual([{ end: "2099-03-02T03:00:00.000Z", start: "2099-03-02T01:00:00.000Z" }]);
    // Seven days after creation is earlier than a window in 2099.
    expect(row.expires_at.getTime()).toBeLessThan(Date.parse("2099-01-01"));
    expect((await reviews(r.requestId))[0]!.state).toBe("applied");
  });

  it("rejects a stale review after another mutation and keeps the newer request", async () => {
    const r = await requester();
    await draftRequestReviewForTool(db, r.call(), { details: { purpose: "Old purpose" }, intent: "details" });
    const [review] = await reviews(r.requestId);
    await asRequester(db, r.requestId, updateDetailsCommand(contact), { details: { purpose: "Newer purpose" }, timezone: "Asia/Seoul" }, {
      expectedRevision: 1,
    });

    const applied = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, { expectedRevision: 1 });

    expect(applied).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect((await details(r.requestId)).details.purpose).toBe("Newer purpose");
  });

  it("denies a window that starts during the lock wait and keeps the review pending", async () => {
    const r = await requester({ durationMinutes: 30 });
    const drafted = await asRequester(db, r.requestId, draftReviewCommand(), {
      clarifications: [],
      intent: "availability",
      patch: { windows: [{ end: later(3600), start: later(2) }] },
    });
    expect(drafted).toMatchObject({ ok: true, result: { recorded: true } });
    const [review] = await reviews(r.requestId);

    // Another transaction holds the request row until the window has started.
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
    const applying = asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, { expectedRevision: 1 });
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    release();
    await holder;

    expect(await applying).toMatchObject({ error: { category: "invalid_input", reason: "start_passed" }, ok: false });
    expect((await reviews(r.requestId))[0]!.state).toBe("pending");
    expect(await revisionOf(db, r.requestId)).toBe(1);
  });

  it("recovers committed review creation and application on an exact retry after the window starts", async () => {
    const r = await requester({ durationMinutes: 30 });
    const input = { clarifications: [], intent: "availability", patch: { windows: [{ end: later(3600), start: later(2) }] } };
    const draftKey = randomUUID();
    const first = await asRequester(db, r.requestId, draftReviewCommand(), input, { retryKey: draftKey });
    const [review] = await reviews(r.requestId);
    const applyKey = randomUUID();
    const applied = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, {
      expectedRevision: 1,
      retryKey: applyKey,
    });
    expect(applied.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 2_500));

    const draftRetry = await asRequester(db, r.requestId, draftReviewCommand(), input, { retryKey: draftKey });
    const applyRetry = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, {
      expectedRevision: 1,
      retryKey: applyKey,
    });

    expect(draftRetry).toMatchObject({ ok: true, replayed: true, result: (first as { result: unknown }).result });
    expect(applyRetry).toMatchObject({ ok: true, replayed: true, result: { revision: 2 } });
    expect(await reviews(r.requestId)).toHaveLength(1);
    expect(await revisionOf(db, r.requestId)).toBe(2);
  });

  it("dismisses a pending review as rejected without changing the request", async () => {
    const r = await requester();
    await draftRequestReviewForTool(db, r.call(), { details: { purpose: "Lunch" }, intent: "details" });
    const [review] = await reviews(r.requestId);

    const dismissed = await asRequester(db, r.requestId, dismissReviewCommand, { reviewId: review!.id }, { expectedRevision: 1 });

    expect(dismissed).toMatchObject({ ok: true, result: { revision: 1 } });
    expect((await reviews(r.requestId))[0]!.state).toBe("rejected");
    expect((await details(r.requestId)).details.purpose).toBe("Talk about compilers");
  });

  it("supersedes the earlier pending review with a newer draft", async () => {
    const r = await requester();
    await draftRequestReviewForTool(db, r.call(), { details: { purpose: "First" }, intent: "details" });
    await draftRequestReviewForTool(db, r.call(), { details: { purpose: "Second" }, intent: "details" });

    expect((await reviews(r.requestId)).map((review) => review.state)).toEqual(["superseded", "pending"]);
  });
});

describe("minimized contact context", () => {
  it("returns contact presence to the model while the protected review keeps the exact edit", async () => {
    const r = await requester();
    const call = r.call();
    const outcome = await draftRequestReviewForTool(db, call, {
      details: { contactEmail: "", contactName: "Grace B. Hopper", purpose: "Lunch" },
      intent: "details",
    });

    expect(outcome).toMatchObject({ recorded: true, review: { patch: { contactEmail: "absent", contactName: "present", purpose: "Lunch" } } });
    expect(JSON.stringify(outcome)).not.toContain("Grace B. Hopper");
    expect((await reviews(r.requestId))[0]!.patch).toEqual({ contactEmail: "", contactName: "Grace B. Hopper", purpose: "Lunch" });

    // A partial edit leaves the omitted field out of the projection.
    const partial = await draftRequestReviewForTool(db, r.call(), { details: { contactName: "Grace" }, intent: "details" });
    expect((partial as { review: { patch: object } }).review.patch).toEqual({ contactName: "present" });

    // The exact retry of the first call recovers the same minimized result.
    expect(await draftRequestReviewForTool(db, call, { details: { contactEmail: "", contactName: "Grace B. Hopper", purpose: "Lunch" }, intent: "details" })).toEqual(outcome);
  });

  it("refuses to apply an emptied contact field", async () => {
    const r = await requester();
    await draftRequestReviewForTool(db, r.call(), { details: { contactEmail: "" }, intent: "details" });
    const [review] = await reviews(r.requestId);

    const applied = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, { expectedRevision: 1 });

    expect(applied).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect((await details(r.requestId)).contact_email).toBe(r.contactEmail);
  });

  it("emails a changed contact address its own confirmation and voids the old address's", async () => {
    const r = await requester();
    const changed = `new-${randomUUID().slice(0, 8)}@example.test`;
    await draftRequestReviewForTool(db, r.call(), { details: { contactEmail: changed }, intent: "details" });
    const [review] = await reviews(r.requestId);

    const applied = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, { expectedRevision: 1 });

    expect(applied.ok).toBe(true);
    const [row] = await db<{ contact_confirmed_email: string | null; contact_email: string }[]>`
      select contact_email, contact_confirmed_email from app.requests where id = ${r.requestId}
    `;
    expect(row).toEqual({ contact_confirmed_email: null, contact_email: changed });
    const confirmations = await db<{ contact_email: string }[]>`
      select contact_email from app.contact_confirmations where request_id = ${r.requestId} and superseded_at is null
    `;
    expect(confirmations.map((entry) => entry.contact_email)).toEqual([changed]);
  });
  it("bounds the creation emails contact changes send, writing nothing past a bound", async () => {
    const r = await requester();
    const deliveries = async () => {
      const [row] = await db<{ count: number }[]>`
        select count(*)::int as count from app.email_deliveries where request_id = ${r.requestId} and kind = 'request_creation'
      `;
      return row!.count;
    };
    const change = (address: string, expectedRevision: number, limits?: object) =>
      asRequester(db, r.requestId, updateDetailsCommand({ ...contact, limits }), { details: { contactEmail: address }, timezone: "Asia/Seoul" }, {
        expectedRevision,
      });
    const address = () => `changed-${randomUUID().slice(0, 8)}@example.test`;

    expect(await change(address(), 1)).toMatchObject({ ok: true, result: { revision: 2 } });
    const after = await details(r.requestId);

    // Within 60 seconds of the last creation email: rejected, nothing written.
    expect(await change(address(), 2)).toMatchObject({ error: { category: "rate_limited" }, ok: false });
    expect(await details(r.requestId)).toEqual(after);
    expect(await deliveries()).toBe(1);

    // Past the spacing, the per-request hourly bound counts the earlier change.
    await db`update app.email_deliveries set created_at = created_at - interval '61 seconds' where request_id = ${r.requestId}`;
    expect(await change(address(), 2, { perRequestHour: 1 })).toMatchObject({ error: { category: "rate_limited" }, ok: false });
    expect(await deliveries()).toBe(1);
    expect(await change(address(), 2)).toMatchObject({ ok: true, result: { revision: 3 } });
  });

  it("rejects a review that changes the contact past the bounds, keeping it pending", async () => {
    const r = await requester();
    const first = `first-${randomUUID().slice(0, 8)}@example.test`;
    await asRequester(db, r.requestId, updateDetailsCommand(contact), { details: { contactEmail: first }, timezone: "Asia/Seoul" }, { expectedRevision: 1 });
    await draftRequestReviewForTool(db, r.call(), { details: { contactEmail: `new-${randomUUID().slice(0, 8)}@example.test` }, intent: "details" });
    const [review] = await reviews(r.requestId);

    const applied = await asRequester(db, r.requestId, applyReviewCommand(contact), { reviewId: review!.id }, { expectedRevision: 2 });

    expect(applied).toMatchObject({ error: { category: "rate_limited" }, ok: false });
    expect((await details(r.requestId)).contact_email).toBe(first);
    expect((await reviews(r.requestId)).map((entry) => entry.state)).toEqual(["pending"]);
  });
});

describe("meeting details card", () => {
  it("saves details directly with the review's validation", async () => {
    const r = await requester({ durationMinutes: null, mode: null, purpose: null });
    const saved = await asRequester(
      db,
      r.requestId,
      updateDetailsCommand(contact),
      {
        details: { durationMinutes: 30, meetingLink: "https://meet.example.test/abc", mode: "online", purpose: "Intro", windows: [{ date: "2099-03-02", end: "11:00", start: "10:00" }] },
        timezone: "Asia/Seoul",
      },
      { expectedRevision: 1 },
    );

    expect(saved).toMatchObject({ ok: true, result: { revision: 2 } });
    expect((await details(r.requestId)).details).toMatchObject({
      durationMinutes: 30,
      linkPlan: { kind: "requester_link", url: "https://meet.example.test/abc" },
      mode: "online",
      purpose: "Intro",
    });

    const http = await asRequester(db, r.requestId, updateDetailsCommand(contact), { details: { meetingLink: "http://insecure.example.test" }, timezone: "Asia/Seoul" }, {
      expectedRevision: 2,
    });
    expect(http).toMatchObject({ error: { category: "invalid_input" }, ok: false });
  });
});
