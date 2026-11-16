import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { isRequestLinkedToAccount, readBookingLinkVisitor } from "../../lib/server/guest-account";
import { closeRequest } from "../../lib/server/request-lifecycle";
import { createRequesterCommandHandler } from "../../lib/server/requester-routes";
import { listWorkspaceRequests } from "../../lib/server/workspace-requests";
import { localAuthConfig, signInHost } from "./support/auth";
import { testDatabase } from "./support/database";
import { call, guestDependencies, readyHost, startedDraft } from "./support/guests";
import { createTestRequest, testTokenKey } from "./support/requests";

// A signed-in account as a guest on another host's booking link
// (host-as-guest-session, #183): **Continue as {name}**, resuming an open
// request and the way back to /app, with the booking link still the request's
// only credential.

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

function identifyAccount(deps: ReturnType<typeof guestDependencies>, bookingId: string, cookie?: string, retryKey = randomUUID()) {
  return call(createRequesterCommandHandler(() => deps), { bookingId }, "/commands", {
    body: { expectedRevision: null, input: { timezone: "Asia/Seoul" }, operation: "request.identify_account", retryKey },
    headers: cookie ? { cookie } : {},
  });
}

async function requestRow(requestId: string) {
  const [row] = await db<{ state: string; requester_name: string | null; contact_email: string | null; contact_confirmed_email: string | null; calendar_settled: boolean }[]>`
    select state, requester_name, contact_email, contact_confirmed_email, calendar_settled_at is not null as calendar_settled
    from app.requests where id = ${requestId}
  `;
  return row!;
}

describe("Continue as the signed-in account", () => {
  it("identifies the draft with the account's name and verified address and links it", async () => {
    const viewer = await signInHost(db);
    await db`update app.host_accounts set display_name = 'Grace Hopper' where id = ${viewer.hostAccountId}`;
    const [identity] = await db<{ email: string }[]>`select email from app.google_identities where auth_user_id = ${viewer.userId}`;
    const host = await readyHost(db);
    const deps = guestDependencies(db, { hostAuth: localAuthConfig() });
    const draft = await startedDraft(deps, host.handle);

    const response = await identifyAccount(deps, draft.bookingId, viewer.cookie);

    expect(response.status).toBe(200);
    expect(await requestRow(draft.requestId)).toEqual({
      calendar_settled: true,
      contact_confirmed_email: identity!.email,
      contact_email: identity!.email,
      requester_name: "Grace Hopper",
      state: "gathering",
    });
    expect(await isRequestLinkedToAccount(db, viewer.userId, draft.requestId)).toBe(true);
    expect((await listWorkspaceRequests(db, viewer.hostAccountId, [testTokenKey])).map((item) => item.requestId)).toContain(draft.requestId);
    // The account's session cookie is not replaced or cleared.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers a retry with the same outcome", async () => {
    const viewer = await signInHost(db);
    const host = await readyHost(db);
    const deps = guestDependencies(db, { hostAuth: localAuthConfig() });
    const draft = await startedDraft(deps, host.handle);
    const retryKey = randomUUID();

    expect((await identifyAccount(deps, draft.bookingId, viewer.cookie, retryKey)).status).toBe(200);
    expect((await identifyAccount(deps, draft.bookingId, viewer.cookie, retryKey)).status).toBe(200);
    expect((await requestRow(draft.requestId)).state).toBe("gathering");
  });

  it("is refused without a session and for the request's own host", async () => {
    const host = await readyHost(db);
    const deps = guestDependencies(db, { hostAuth: localAuthConfig() });
    const anonymous = await startedDraft(deps, host.handle);

    expect((await identifyAccount(deps, anonymous.bookingId)).status).toBe(401);
    expect((await requestRow(anonymous.requestId)).state).toBe("draft");

    // The signed-in account is the request's host.
    const self = await signInHost(db);
    const own = await startedDraft(deps, host.handle);
    await db`update app.requests set host_account_id = ${self.hostAccountId} where id = ${own.requestId}`;

    expect((await identifyAccount(deps, own.bookingId, self.cookie)).status).toBe(404);
    expect((await requestRow(own.requestId)).state).toBe("draft");
  });

  it("is refused for a suspended account", async () => {
    const viewer = await signInHost(db);
    await db`update app.host_accounts set status = 'suspended' where id = ${viewer.hostAccountId}`;
    const host = await readyHost(db);
    const deps = guestDependencies(db, { hostAuth: localAuthConfig() });
    const draft = await startedDraft(deps, host.handle);

    expect((await identifyAccount(deps, draft.bookingId, viewer.cookie)).status).toBe(404);
    expect((await requestRow(draft.requestId)).state).toBe("draft");
  });
});

describe("the booking link's signed-in visitor", () => {
  it("offers the account's newest open linked request with this host only", async () => {
    const viewer = await signInHost(db);
    const other = await signInHost(db);
    const host = await readyHost(db);
    const elsewhere = await createTestRequest(db);
    const open = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    const unlinked = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await db`
      insert into app.requester_host_profiles (request_id, host_account_id)
      values (${open.requestId}, ${viewer.hostAccountId}), (${elsewhere.requestId}, ${viewer.hostAccountId})
    `;
    await db`update app.requests set updated_at = now() - interval '1 hour' where id = ${unlinked.requestId}`;

    expect(await readBookingLinkVisitor(db, viewer.userId, host.hostAccountId, [testTokenKey])).toMatchObject({
      ownLink: false,
      openRequestPath: `/booking/${open.bookingId}`,
    });
    expect((await readBookingLinkVisitor(db, other.userId, host.hostAccountId, [testTokenKey]))?.openRequestPath).toBeNull();
    expect(await readBookingLinkVisitor(db, viewer.userId, viewer.hostAccountId, [testTokenKey])).toMatchObject({
      openRequestPath: null,
      ownLink: true,
    });
  });

  it("offers no closed request and no expired link", async () => {
    const viewer = await signInHost(db);
    const host = await readyHost(db);
    const closed = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    const expired = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await db`
      insert into app.requester_host_profiles (request_id, host_account_id)
      values (${closed.requestId}, ${viewer.hostAccountId}), (${expired.requestId}, ${viewer.hostAccountId})
    `;
    await db.begin((tx) => closeRequest(tx, closed.requestId, "withdrawn"));
    await db`update app.booking_links set expires_at = now() - interval '1 minute' where request_id = ${expired.requestId}`;

    expect((await readBookingLinkVisitor(db, viewer.userId, host.hostAccountId, [testTokenKey]))?.openRequestPath).toBeNull();
  });

  it("links the guest page back to /app only for the linked account", async () => {
    const viewer = await signInHost(db);
    const other = await signInHost(db);
    const sent = await createTestRequest(db);
    await db`insert into app.requester_host_profiles (request_id, host_account_id) values (${sent.requestId}, ${viewer.hostAccountId})`;

    expect(await isRequestLinkedToAccount(db, viewer.userId, sent.requestId)).toBe(true);
    expect(await isRequestLinkedToAccount(db, other.userId, sent.requestId)).toBe(false);
  });
});
