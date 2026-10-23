import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveCommand, BOOKING_PENDING_JOB, createBookingPendingHandler } from "../../lib/server/bookings";
import { requestRef, reviewRef } from "../../lib/server/imessage-commands";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { enqueueHostNotice, IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { publishJob } from "../../lib/server/jobs";
import { identifyDraft, insertDraftRequest } from "../../lib/server/request-start";
import { lockOpenRequest } from "../../lib/server/request-guard";
import { agreedRequest, asHost, bookingDeps, bookingOf, runBooking } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";
import { makeHostReady } from "./support/ready-host";
import { runJob, testNotices, testTokenKey } from "./support/requests";
import { revisionOf } from "./support/scheduling";

// Host summaries and outcomes (host-imessage-channel task 4.4): each event of a
// linked host's request (a new request, a proposal awaiting approval, a booking
// confirmed, failed or still pending) is queued once to the linked
// conversation; a host without a binding gets nothing; a summary for an
// outdated version is skipped; and a failed delivery shows on the web and leaves
// the request as it was.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

const noticeDeps = () => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] });

// Runs the request's pending notice jobs, then sends what they queued.
async function noticesSent(hostAccountId: string, requestId: string) {
  const jobs = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and state = 'pending' and payload ->> 'requestId' = ${requestId}
    order by created_at
  `;
  for (const job of jobs) await runJob(db, job.id, createImessageNoticeHandler(noticeDeps));
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'notice' and state = 'queued' order by created_at
  `;
  const texts: string[] = [];
  for (const row of rows) texts.push(...textOf((await im.send(row.id)).sent));
  return texts;
}

async function linkedAgreed() {
  let sender = "";
  const request = await agreedRequest(db, google, {
    beforeAgree: async (seeded) => {
      sender = (await im.link(seeded.hostAccountId)).sender;
    },
  });
  return { request, sender };
}

describe("host summaries", () => {
  it("summarizes a proposal awaiting approval once, with its exact commands", async () => {
    const { request } = await linkedAgreed();
    const [text] = await noticesSent(request.hostAccountId, request.requestId);
    expect(text).toMatch(/^Ready for your approval\./);
    expect(text).toContain(`approve ${reviewRef(request.requestId, 1)}`);
    expect(text).toContain(`decline ${reviewRef(request.requestId, 1)}`);

    await db.begin((tx) => enqueueHostNotice(tx, request.requestId, { kind: "awaiting_approval", version: 1 }));
    expect(await noticesSent(request.hostAccountId, request.requestId)).toEqual([]);
  });

  it("sends nothing to a host without a binding, and skips an outdated version", async () => {
    const plain = await agreedRequest(db, google);
    expect(await db`select 1 from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and payload ->> 'requestId' = ${plain.requestId}`).toHaveLength(0);

    const { request } = await linkedAgreed();
    await db.begin((tx) => enqueueHostNotice(tx, request.requestId, { kind: "awaiting_approval", version: 9 }));
    const texts = await noticesSent(request.hostAccountId, request.requestId);
    expect(texts.filter((text) => text.includes("Proposal 9"))).toEqual([]);
  });

  it("reports a confirmed booking", async () => {
    const { request } = await linkedAgreed();
    await noticesSent(request.hostAccountId, request.requestId);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error("approve failed");
    await runBooking(db, bookingDeps(db, google), approved.result.bookingId);
    expect(await bookingOf(db, approved.result.bookingId)).toMatchObject({ state: "confirmed" });
    const [text] = await noticesSent(request.hostAccountId, request.requestId);
    expect(text).toMatch(/^Booked with Grace Hopper: .+\. It's on your calendar\.$/);
  });

  it("reports a booking that was not confirmed, or is still pending", async () => {
    const { request } = await linkedAgreed();
    await noticesSent(request.hostAccountId, request.requestId);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error("approve failed");
    const bookingId = approved.result.bookingId;

    await db`update app.bookings set state = 'dispatching', dispatched_at = now(), payload = '{}'::jsonb where id = ${bookingId}`;
    // The 15-minute pending check, as the dispatch schedules it.
    const pendingJob = await db.begin((tx) => publishJob(tx, { dedupeKey: `test:${bookingId}`, kind: BOOKING_PENDING_JOB, payload: { bookingId } }));
    await runJob(db, pendingJob!, createBookingPendingHandler(() => testNotices));
    expect((await noticesSent(request.hostAccountId, request.requestId))[0]).toContain("is taking longer than usual to confirm");

    await db`update app.bookings set state = 'reserved', dispatched_at = null, payload = null where id = ${bookingId}`;
    request.setCalendar({ insertBehavior: { [request.calendarId]: { status: 403 } } });
    await runBooking(db, bookingDeps(db, google), bookingId);
    expect((await noticesSent(request.hostAccountId, request.requestId))[0]).toContain("wasn't confirmed");
  });

  it("announces a new request when the requester is identified", async () => {
    const { hostAccountId } = await hostWithUser(db);
    await makeHostReady(db, hostAccountId);
    await im.link(hostAccountId);
    const requestId = await db.begin(async (tx) => {
      const id = await insertDraftRequest(tx, { hostAccountId, language: "en", sourceHash: "a".repeat(64), timezone: "Asia/Seoul", tokenKey: testTokenKey });
      const request = await lockOpenRequest(tx, id);
      await identifyDraft(tx, request, { email: "grace@example.test", name: "Grace Hopper", timezone: "Asia/Seoul" }, { origin: "http://localhost:3000", tokenKey: testTokenKey });
      return id;
    });
    const [text] = await noticesSent(hostAccountId, requestId);
    expect(text).toBe(`New request ${requestRef(requestId)} from Grace Hopper. Send request ${requestRef(requestId)} to discuss it here.`);
  });

  it("shows a failed summary on the web and leaves the request as it was", async () => {
    const { request } = await linkedAgreed();
    const [job] = await db<{ id: string }[]>`
      select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and payload ->> 'requestId' = ${request.requestId}
    `;
    await runJob(db, job!.id, createImessageNoticeHandler(noticeDeps));
    const [row] = await db<{ id: string }[]>`select id from app.imessage_outbox where request_id = ${request.requestId} and kind = 'notice'`;
    photon.nextSend({ category: "not_imessage", status: 422 });
    await im.send(row!.id);

    expect(await im.status(request.hostAccountId)).toMatchObject({ delivery: { state: "failed" }, state: "linked" });
    expect((await db<{ state: string }[]>`select state from app.requests where id = ${request.requestId}`)[0]!.state).toBe("awaiting_host_approval");
  });
});
