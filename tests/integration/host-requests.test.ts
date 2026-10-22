import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveCommand } from "../../lib/server/bookings";
import { createHostRequestCommandHandler, createHostRequestHandler, createHostRequestListHandler } from "../../lib/server/host-request-routes";
import { listHostRequests, readHostRequest } from "../../lib/server/host-requests";
import { agreeCommand, readCurrentEvaluation } from "../../lib/server/request-proposals";
import { allowHostTripCommand, hostEvaluateCommand, waiveWeeklyLimitCommand } from "../../lib/server/request-exceptions";
import { dismissChangesCommand, shareChangesCommand, suggestChangesCommand } from "../../lib/server/shared-changes";
import { localAuthConfig, signInHost } from "./support/auth";
import { agreedRequest, asHost, deliveriesOf, requestState } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { createTestRequest, testNotices } from "./support/requests";
import { asRequester, busy, evaluationDeps, MONDAY, revisionOf, runEvaluation, seedSchedulingRequest, seoul } from "./support/scheduling";

// The host's side of a request (tasks 3.3 to 3.5; design 3, 4 and 8): the inbox
// and projection limited to the host's own requests and never a draft or a
// booking link, suggestions shared as a checked new version or rejected
// privately, and the rule and travel review's trip allowance and weekly-limit
// waiver, which never reach the requester.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

const deps = () => ({ ...evaluationDeps(db, google), notices: testNotices });

describe("the host projection", () => {
  it("lists only the host's own requests, never a draft, and carries no booking link", async () => {
    const request = await agreedRequest(db, google);
    const draft = await createTestRequest(db, { hostAccountId: request.hostAccountId });
    await db`update app.requests set state = 'draft', requester_name = null, contact_email = null where id = ${draft.requestId}`;
    const other = await createTestRequest(db);

    const items = await listHostRequests(db, request.hostAccountId);
    expect(items.map((item) => item.requestId)).toEqual([request.requestId]);
    expect(items[0]).toMatchObject({ needsDecision: true, requesterName: "Grace Hopper", state: "awaiting_host_approval" });

    const view = await readHostRequest(db, request.hostAccountId, request.requestId);
    expect(view?.proposal?.agreedAt).not.toBeNull();
    expect(view?.requester.email).toBe(request.contactEmail);
    expect(JSON.stringify(view)).not.toContain(request.bookingId);
    expect(await readHostRequest(db, request.hostAccountId, other.requestId)).toBeNull();
    expect(await readHostRequest(db, request.hostAccountId, draft.requestId)).toBeNull();
  });

  it("serves the routes only to the request's own signed-in host", async () => {
    const host = await signInHost(db);
    const mine = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    const theirs = await createTestRequest(db);
    const routeDeps = () => ({ appOrigin: "http://localhost:3000", auth: localAuthConfig(), db }) as never;
    const get = (id: string) =>
      createHostRequestHandler(routeDeps)(new Request(`http://localhost:3000/api/host/requests/${id}`, { headers: { cookie: host.cookie } }), {
        params: Promise.resolve({ requestId: id }),
      });

    expect((await get(mine.requestId)).status).toBe(200);
    expect((await get(theirs.requestId)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);

    const list = await createHostRequestListHandler(routeDeps)(new Request("http://localhost:3000/api/host/requests", { headers: { cookie: host.cookie } }));
    expect(((await list.json()) as { requests: { requestId: string }[] }).requests.map((item) => item.requestId)).toEqual([mine.requestId]);

    const signedOut = await createHostRequestListHandler(routeDeps)(new Request("http://localhost:3000/api/host/requests"));
    expect(signedOut.status).toBe(401);

    const command = await createHostRequestCommandHandler(routeDeps)(
      new Request(`http://localhost:3000/api/host/requests/${theirs.requestId}/commands`, {
        body: JSON.stringify({ input: {}, operation: "request.decline", retryKey: randomUUID() }),
        headers: { cookie: host.cookie, "content-type": "application/json", origin: "http://localhost:3000" },
        method: "POST",
      }),
      { params: Promise.resolve({ requestId: theirs.requestId }) },
    );
    expect(command.status).toBe(404);
    expect((await requestState(db, theirs.requestId)).state).toBe("gathering");
  });
});

describe("shared changes", () => {
  it("shares a feasible later time as a checked new version and emails the requester", async () => {
    const request = await agreedRequest(db, google);
    const later = seoul("10:30");
    const suggested = await asHost(db, request.hostAccountId, request.requestId, suggestChangesCommand("host"), { changes: { start: later } });
    expect(suggested.ok).toBe(true);
    if (!suggested.ok) return;

    // A newer suggestion supersedes it.
    const second = await asHost(db, request.hostAccountId, request.requestId, suggestChangesCommand("host"), {
      changes: { durationMinutes: 45, start: later },
    });
    if (!second.ok) throw new Error("suggest failed");
    const shared = await asHost(db, request.hostAccountId, request.requestId, shareChangesCommand, { suggestionId: suggested.result.suggestionId }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(!shared.ok && shared.error.category).toBe("stale_revision");

    const share = await asHost(db, request.hostAccountId, request.requestId, shareChangesCommand, { suggestionId: second.result.suggestionId }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(share.ok).toBe(true);
    if (!share.ok) return;
    expect((await requestState(db, request.requestId)).state).toBe("negotiating");

    await runEvaluation(db, deps(), share.result.evaluationId);

    const view = await readHostRequest(db, request.hostAccountId, request.requestId);
    expect(view?.suggestion).toMatchObject({ proposalVersion: 2, state: "shared" });
    expect(view?.proposal).toMatchObject({ agreedAt: null, durationMinutes: 45, start: new Date(later).toISOString(), version: 2 });
    expect((await deliveriesOf(db, request.requestId)).map((email) => email.kind)).toEqual(["status_new_version"]);

    // The old version cannot be approved; the requester agrees to the new one.
    const stale = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(stale.ok).toBe(false);
    const agreed = await asRequester(db, request.requestId, agreeCommand, { version: 2 }, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(agreed.ok).toBe(true);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 2 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    expect(approved.ok).toBe(true);
  });

  it("rejects a shared time that is busy, privately, and creates no version", async () => {
    const request = await agreedRequest(db, google, { events: [busy("14:00", "15:00")] });
    const suggested = await asHost(db, request.hostAccountId, request.requestId, suggestChangesCommand("assistant"), {
      changes: { start: seoul("14:00") },
    });
    if (!suggested.ok) throw new Error("suggest failed");
    const share = await asHost(db, request.hostAccountId, request.requestId, shareChangesCommand, { suggestionId: suggested.result.suggestionId }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!share.ok) throw new Error("share failed");
    await runEvaluation(db, deps(), share.result.evaluationId);

    const view = await readHostRequest(db, request.hostAccountId, request.requestId);
    expect(view?.suggestion).toMatchObject({ state: "rejected" });
    expect(view?.suggestion?.rejectionReason).toBeTruthy();
    expect(view?.proposal?.version).toBe(1);
    expect(await deliveriesOf(db, request.requestId)).toEqual([]);
  });

  it("dismisses a suggestion without changing anything shared", async () => {
    const request = await agreedRequest(db, google);
    const revision = await revisionOf(db, request.requestId);
    const suggested = await asHost(db, request.hostAccountId, request.requestId, suggestChangesCommand("host"), { changes: { durationMinutes: 60 } });
    if (!suggested.ok) throw new Error("suggest failed");

    const dismissed = await asHost(db, request.hostAccountId, request.requestId, dismissChangesCommand, { suggestionId: suggested.result.suggestionId });
    expect(dismissed.ok).toBe(true);
    expect(await requestState(db, request.requestId)).toMatchObject({ revision, state: "awaiting_host_approval" });
  });
});

describe("the rule and travel review", () => {
  it("holds every candidate in a full week until the host waives the limit (Only full weeks)", async () => {
    const tuesday = new Date(Date.parse(`${MONDAY}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const request = await seedSchedulingRequest(db, google, {
      events: [{ end: { dateTime: seoul("11:00", tuesday) }, id: `event-${randomUUID()}`, start: { dateTime: seoul("10:00", tuesday) }, status: "confirmed" }],
      settings: { weeklyLimit: 1 },
    });
    const found = await asHost(db, request.hostAccountId, request.requestId, hostEvaluateCommand(), {}, { retryKey: "find" });
    if (!found.ok) throw new Error("evaluate failed");
    await runEvaluation(db, deps(), found.result.evaluationId);

    expect((await readCurrentEvaluation(db, request.requestId))?.candidates).toEqual([]);
    const held = await readHostRequest(db, request.hostAccountId, request.requestId);
    expect(held?.evaluation?.weeklyLimitHold).toBe(true);
    expect(held?.needsDecision).toBe(true);

    const waived = await asHost(db, request.hostAccountId, request.requestId, waiveWeeklyLimitCommand(), {}, { retryKey: "waive" });
    if (!waived.ok) throw new Error("waive failed");
    await runEvaluation(db, deps(), waived.result.evaluationId);

    const offered = await readCurrentEvaluation(db, request.requestId);
    expect(offered?.candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(offered)).not.toMatch(/weekly|limit|waive/i);
    expect((await readHostRequest(db, request.hostAccountId, request.requestId))?.weeklyLimitWaived).toBe(true);
  });

  it("applies a host allowance for an unresolved trip of one candidate (Manual allowance confirmed)", async () => {
    const office = `Office ${randomUUID()}, Gangnam`;
    const request = await seedSchedulingRequest(db, google, {
      details: { location: `Cafe ${randomUUID()}`, mode: "in_person", windows: [{ end: seoul("13:00"), start: seoul("12:00") }] },
      events: [{ ...busy("10:00", "11:00"), location: office }],
    });
    const found = await asHost(db, request.hostAccountId, request.requestId, hostEvaluateCommand(), {}, { retryKey: "find" });
    if (!found.ok) throw new Error("evaluate failed");
    await runEvaluation(db, deps(), found.result.evaluationId);

    const before = await readHostRequest(db, request.hostAccountId, request.requestId);
    const candidate = before!.evaluation!.candidates.find((entry) => entry.start === seoul("12:00"))!;
    expect(candidate.status).toBe("host_unresolved");
    expect(candidate.hostLegs.find((leg) => leg.direction === "inbound")?.canAllow).toBe(true);
    expect((await readCurrentEvaluation(db, request.requestId))?.candidates).toEqual([]);

    const allowed = await asHost(db, request.hostAccountId, request.requestId, allowHostTripCommand(), {
      candidateId: candidate.id,
      direction: "inbound",
      evaluationId: before!.evaluation!.id,
      minutes: 30,
    });
    if (!allowed.ok) throw new Error(`allow failed: ${allowed.error.category}`);
    await runEvaluation(db, deps(), allowed.result.evaluationId);

    const after = await readCurrentEvaluation(db, request.requestId);
    expect(after?.candidates.map((entry) => entry.start)).toContain(seoul("12:00"));
    expect(JSON.stringify(after)).not.toMatch(/allowance|minutes for|Office/);
  });

  it("refuses an allowance for a leg that is not unresolved", async () => {
    const request = await seedSchedulingRequest(db, google);
    const found = await asHost(db, request.hostAccountId, request.requestId, hostEvaluateCommand(), {}, { retryKey: "find" });
    if (!found.ok) throw new Error("evaluate failed");
    await runEvaluation(db, deps(), found.result.evaluationId);
    const view = await readHostRequest(db, request.hostAccountId, request.requestId);

    const refused = await asHost(db, request.hostAccountId, request.requestId, allowHostTripCommand(), {
      candidateId: view!.evaluation!.candidates[0]!.id,
      direction: "inbound",
      evaluationId: view!.evaluation!.id,
      minutes: 30,
    });
    expect(!refused.ok && refused.error.category).toBe("invalid_input");
  });
});
