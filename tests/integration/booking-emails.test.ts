import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveCommand, declineCommand } from "../../lib/server/bookings";
import { createEmailDeliveryHandler, EMAIL_DELIVERY_JOB } from "../../lib/server/email-delivery";
import { readRequesterView } from "../../lib/server/requester-routes";
import { agreeCommand } from "../../lib/server/request-proposals";
import { shareChangesCommand, suggestChangesCommand } from "../../lib/server/shared-changes";
import { agreedRequest, asHost, bookingDeps, bookingOf, runBooking } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeCloudflare, startFakeCloudflare } from "./support/fake-cloudflare";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { runJob, testNotices, testTokenKey } from "./support/requests";
import { asRequester, evaluationDeps, revisionOf, runEvaluation, seoul } from "./support/scheduling";

// The confirmation and the requester status emails (tasks 5.1 to 5.3; design 9
// and 10) from the booking job to the fake Cloudflare: both copies with the host
// on the From header, Reply-To the other party and the calendar part only with
// the event's iCalUID; status notices suppressed once no longer current; a
// rejected confirmation leaving the booking confirmed; and the receipt at the
// booking link after closure.

const db = testDatabase();
let google: FakeGoogle;
let cloudflare: FakeCloudflare;

beforeAll(async () => {
  google = await startFakeGoogle();
  cloudflare = await startFakeCloudflare();
});

afterAll(async () => {
  await google.close();
  await cloudflare.close();
  await db.end();
});

const handler = () =>
  createEmailDeliveryHandler(() => ({
    config: { accountId: "acct_test", apiToken: "cf_test_token", baseUrl: cloudflare.baseUrl, from: "no-reply@findmeatime.com", timeoutMs: 2_000 },
    db,
    env: {},
    tokenKeys: [testTokenKey],
  }));

async function deliverAll(requestId: string) {
  const jobs = await db<{ id: string }[]>`
    select j.id from app.jobs j join app.email_deliveries d on d.id = (j.payload ->> 'deliveryId')::uuid
    where j.kind = ${EMAIL_DELIVERY_JOB} and j.state = 'pending' and d.request_id = ${requestId} and d.kind <> 'request_creation'
  `;
  for (const job of jobs) await runJob(db, job.id, handler());
}

async function states(requestId: string) {
  return db<{ kind: string; recipients: string[]; state: string }[]>`
    select kind, recipients, state from app.email_deliveries where request_id = ${requestId} and kind <> 'request_creation'
    order by created_at
  `;
}

async function booked() {
  const request = await agreedRequest(db, google);
  const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
    expectedRevision: await revisionOf(db, request.requestId),
  });
  if (!approved.ok) throw new Error("approve failed");
  await runBooking(db, bookingDeps(db, google), approved.result.bookingId);
  return { ...request, bookingId: approved.result.bookingId, link: request.bookingId };
}

describe("the confirmation", () => {
  it("sends each party a copy with the host's name, Reply-To the other party and the matching calendar part", async () => {
    const request = await booked();
    await deliverAll(request.requestId);

    const [requesterCopy] = cloudflare.messagesTo(request.contactEmail);
    const [hostCopy] = cloudflare.messagesTo(request.calendarId);
    expect(requesterCopy).toMatchObject({ from: "Ada Lovelace <no-reply@findmeatime.com>", reply_to: request.calendarId });
    expect(requesterCopy!.subject).toBe("Talk about compilers between Ada Lovelace and Grace Hopper");
    expect(requesterCopy!.text).toContain(`http://localhost:3000/booking/${request.link}`);
    expect(requesterCopy!.text).toContain("Join meeting: https://meet.google.com/");
    expect(requesterCopy!.attachments?.[0]).toMatchObject({ disposition: "attachment", filename: "invite.ics", type: "text/calendar; method=REQUEST; charset=UTF-8" });
    const ics = Buffer.from(requesterCopy!.attachments![0]!.content, "base64").toString("utf8").replaceAll("\r\n ", "");
    const [booking] = await db<{ evidence: { iCalUID: string } }[]>`select evidence from app.bookings where id = ${request.bookingId}`;
    expect(ics).toContain(`UID:${booking!.evidence.iCalUID}`);

    expect(hostCopy).toMatchObject({ reply_to: request.contactEmail });
    expect(hostCopy!.text).toContain(`http://localhost:3000/app?request=${request.requestId}`);
    expect(hostCopy!.text).not.toContain(request.link);
    expect((await states(request.requestId)).map((row) => row.state)).toEqual(["accepted", "accepted"]);
  });

  it("leaves the calendar part out when the event's iCalUID is unknown", async () => {
    const request = await agreedRequest(db, google);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error("approve failed");
    await runBooking(db, bookingDeps(db, google, {
      openCalendar: async () => ({
        conferenceSolutionTypes: async () => [],
        getEvent: async () => ({ outcome: "absent" }),
        insertEvent: async (_calendar, event) => ({
          event: { htmlLink: null, iCalUID: null, id: String(event.id), joinUrl: null, organizerEmail: null, organizerName: null, status: "confirmed" },
          outcome: "created",
        }),
        listCalendars: async () => ({ calendars: [], primaryTimeZone: null }),
        listEvents: async () => [],
      }),
    }), approved.result.bookingId);
    await deliverAll(request.requestId);

    expect(cloudflare.messagesTo(request.contactEmail)[0]?.attachments).toBeUndefined();
  });

  it("keeps the booking confirmed when a copy bounces, and sends nothing twice", async () => {
    const request = await agreedRequest(db, google);
    cloudflare.setBehavior(request.contactEmail, "bounce");
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error("approve failed");
    await runBooking(db, bookingDeps(db, google), approved.result.bookingId);
    await deliverAll(request.requestId);
    await deliverAll(request.requestId);

    expect((await states(request.requestId)).find((row) => row.recipients[0] === request.contactEmail)?.state).toBe("rejected");
    expect((await bookingOf(db, approved.result.bookingId)).state).toBe("confirmed");
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(1);
  });
});

describe("the receipt at the booking link", () => {
  it("shows only the status and receipt once the request is booked", async () => {
    const request = await booked();
    const view = await readRequesterView(db, request.requestId);

    expect(view?.open).toBe(false);
    if (view?.open !== false) return;
    expect(view.request.state).toBe("booked");
    expect(view.booking?.receipt).toMatchObject({ mode: "online", requester: { email: request.contactEmail } });
    expect(view.booking?.receipt?.calendarUrl).toBeNull();
    expect(view.timezone).toBe("Asia/Seoul");
    expect(JSON.stringify(view)).not.toMatch(/purpose|windows|evaluation/);
  });
});

describe("status notifications", () => {
  it("emails a new version and suppresses it once the requester agreed", async () => {
    const request = await agreedRequest(db, google);
    const suggested = await asHost(db, request.hostAccountId, request.requestId, suggestChangesCommand("host"), { changes: { start: seoul("10:30") } });
    if (!suggested.ok) throw new Error("suggest failed");
    const shared = await asHost(db, request.hostAccountId, request.requestId, shareChangesCommand, { suggestionId: suggested.result.suggestionId }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!shared.ok) throw new Error("share failed");
    await runEvaluation(db, { ...evaluationDeps(db, google), notices: testNotices }, shared.result.evaluationId);

    await asRequester(db, request.requestId, agreeCommand, { version: 2 }, { expectedRevision: await revisionOf(db, request.requestId) });
    await deliverAll(request.requestId);

    expect(await states(request.requestId)).toEqual([{ kind: "status_new_version", recipients: [request.contactEmail], state: "suppressed" }]);
    expect(cloudflare.messagesTo(request.contactEmail)).toHaveLength(0);
  });

  it("emails a decline to the requester's address, confirmed or not", async () => {
    const request = await agreedRequest(db, google);
    await asHost(db, request.hostAccountId, request.requestId, declineCommand(() => testNotices), {}, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    await deliverAll(request.requestId);

    const [message] = cloudflare.messagesTo(request.contactEmail);
    expect(message?.subject).toBe("Your meeting request with Ada Lovelace was closed");
    expect(message?.text).toContain(`/booking/${request.bookingId}`);
    expect(message?.from).toBe("Find Me a Time <no-reply@findmeatime.com>");
  });
});
