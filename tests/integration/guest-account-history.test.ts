import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_REQUESTS_CLOSE_JOB, createAccountRequestsCloseHandler } from "../../lib/server/account-requests-close";
import { BOOKING_CANCEL_JOB } from "../../lib/server/booking-cancellation";
import { approveCommand } from "../../lib/server/bookings";
import { createSentRequestConversationHandler } from "../../lib/server/host-request-routes";
import { listWorkspaceRequests } from "../../lib/server/workspace-requests";
import { localAuthConfig, signInHost } from "./support/auth";
import { agreedRequest, asHost, bookingDeps, bookingOf, deliveriesOf, requestState, runBooking } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { createTestRequest, jobFor, runJob, testNotices, testTokenKey } from "./support/requests";
import { revisionOf } from "./support/scheduling";

// A signed-in guest account's request history, its conversation and what its
// deletion does to the requests it sent (guest-account-history D1 to D3).

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

// Drains the closed-request rule, which deletes at most 100 requests a pass,
// so other suites' old requests cannot hide this suite's.
async function retention() {
  for (let pass = 0; pass < 50; pass += 1) {
    const rows = await db<{ rule: string; deleted: number }[]>`select * from app.cleanup_retained_records(1000)`;
    if ((rows.find((row) => row.rule === "closed_requests")?.deleted ?? 0) === 0) return;
  }
}

async function requestExists(requestId: string) {
  const [row] = await db<{ found: boolean }[]>`select exists (select 1 from app.requests where id = ${requestId}) as found`;
  return row!.found;
}

async function own(requestId: string, hostAccountId: string) {
  await db`insert into app.requester_host_profiles (request_id, host_account_id) values (${requestId}, ${hostAccountId})`;
}

async function deleteAccount(hostAccountId: string) {
  await db`select * from app.operator_delete_host(${hostAccountId}, 'test', 'guest-account-history', 'local')`;
}

async function bookedFor(guestAccountId: string) {
  const request = await agreedRequest(db, google);
  const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
    expectedRevision: await revisionOf(db, request.requestId),
  });
  if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
  expect(await runBooking(db, bookingDeps(db, google), approved.result.bookingId)).toBe("completed");
  await own(request.requestId, guestAccountId);
  return { ...request, bookingId: approved.result.bookingId };
}

describe("history retention", () => {
  it("keeps a closed request a live account owns past 90 days, and applies the 90 days once the account is deleted", async () => {
    const guest = await signInHost(db);
    const owned = await createTestRequest(db);
    const unowned = await createTestRequest(db);
    await own(owned.requestId, guest.hostAccountId);
    await db`
      update app.requests set state = 'withdrawn', closed_at = now() - interval '120 days'
      where id in ${db([owned.requestId, unowned.requestId])}
    `;

    await retention();
    expect(await requestExists(owned.requestId)).toBe(true);
    expect(await requestExists(unowned.requestId)).toBe(false);
    expect((await listWorkspaceRequests(db, guest.hostAccountId, [testTokenKey])).find((item) => item.requestId === owned.requestId)).toMatchObject({
      active: false,
      direction: "sent",
      state: "withdrawn",
    });

    await deleteAccount(guest.hostAccountId);
    await retention();
    expect(await requestExists(owned.requestId)).toBe(false);
  });

  it("keeps a recently closed request with its host after the account is deleted", async () => {
    const guest = await signInHost(db);
    const owned = await createTestRequest(db);
    await own(owned.requestId, guest.hostAccountId);
    await db`update app.requests set state = 'withdrawn', closed_at = now() - interval '10 days' where id = ${owned.requestId}`;

    await deleteAccount(guest.hostAccountId);
    await retention();
    expect(await requestExists(owned.requestId)).toBe(true);
  });
});

describe("account deletion and sent requests", () => {
  it("withdraws the account's open sent requests and cancels its booked meeting, telling the host", async () => {
    const guest = await signInHost(db);
    const open = await createTestRequest(db);
    const lapsed = await createTestRequest(db);
    const closed = await createTestRequest(db);
    await own(open.requestId, guest.hostAccountId);
    await own(lapsed.requestId, guest.hostAccountId);
    await own(closed.requestId, guest.hostAccountId);
    // Past its expiry but not yet swept: closed by the job, not the expiry job.
    await db`update app.requests set expires_at = now() - interval '1 minute' where id = ${lapsed.requestId}`;
    await db`update app.requests set state = 'declined', closed_at = now() where id = ${closed.requestId}`;
    const booked = await bookedFor(guest.hostAccountId);

    await deleteAccount(guest.hostAccountId);

    const job = await jobFor(db, ACCOUNT_REQUESTS_CLOSE_JOB, `account:${guest.hostAccountId}`);
    expect(job?.state).toBe("pending");
    const [payload] = await db<{ request_ids: string[] }[]>`
      select array(select jsonb_array_elements_text(payload -> 'requestIds')) as request_ids from app.jobs where id = ${job!.id}
    `;
    expect([...payload!.request_ids].sort()).toEqual([open.requestId, lapsed.requestId, booked.requestId].sort());
    // The deletion removed the account's matches but not the hosts' requests.
    expect(await db`select 1 from app.requester_host_profiles where host_account_id = ${guest.hostAccountId}`).toHaveLength(0);

    expect(await runJob(db, job!.id, createAccountRequestsCloseHandler(() => testNotices))).toBe("completed");
    expect((await requestState(db, open.requestId)).state).toBe("withdrawn");
    expect((await requestState(db, lapsed.requestId)).state).toBe("withdrawn");
    expect((await requestState(db, closed.requestId)).state).toBe("declined");
    expect((await requestState(db, booked.requestId)).state).toBe("cancelled");
    expect(await bookingOf(db, booked.bookingId)).toMatchObject({ failure_category: "requester_cancelled", state: "cancelled" });
    expect((await deliveriesOf(db, booked.requestId)).some((email) => email.kind === "booking_cancelled")).toBe(true);
    expect(await jobFor(db, BOOKING_CANCEL_JOB, `cancel:${booked.bookingId}`)).not.toBeNull();
  });

  it("publishes nothing for an account that sent no open request", async () => {
    const guest = await signInHost(db);
    await deleteAccount(guest.hostAccountId);
    expect(await jobFor(db, ACCOUNT_REQUESTS_CLOSE_JOB, `account:${guest.hostAccountId}`)).toBeNull();
  });
});

describe("sent request conversation", () => {
  const route = createSentRequestConversationHandler(() => ({ appOrigin: "http://localhost:3000", auth: localAuthConfig(), db }) as never);
  const get = (requestId: string, cookie?: string) =>
    route(new Request(`http://localhost:3000/api/host/workspace-requests/${requestId}/conversation?cursor=0`, { headers: cookie ? { cookie } : {} }), {
      params: Promise.resolve({ requestId }),
    });

  it("serves only the account's own sent request, closed included", async () => {
    const guest = await signInHost(db);
    const outsider = await signInHost(db);
    const sent = await createTestRequest(db);
    const received = await createTestRequest(db, { hostAccountId: guest.hostAccountId });
    await own(sent.requestId, guest.hostAccountId);
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${sent.requestId}`;
    await db`update app.booking_links set expires_at = now() - interval '1 minute' where request_id = ${sent.requestId}`;

    // The test request has no discussion yet, so the stream is empty.
    const response = await get(sent.requestId, guest.cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");

    expect((await get(sent.requestId, outsider.cookie)).status).toBe(404);
    expect((await get(received.requestId, guest.cookie)).status).toBe(404);
    expect((await get("not-an-id", guest.cookie)).status).toBe(404);
    expect((await get(sent.requestId)).status).toBe(401);
  });
});
