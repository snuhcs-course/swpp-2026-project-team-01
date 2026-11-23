import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountRequest, readAccountRequester } from "../../lib/server/account-requests";
import { enqueueStatusNotice } from "../../lib/server/booking-notices";
import { runCommand } from "../../lib/server/commands";
import { bindHostConversation } from "../../lib/server/host-conversation-bindings";
import { listSentRequests } from "../../lib/server/host-sent-requests";
import { requestRef } from "../../lib/server/imessage-commands";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { guestNoticeKey, IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { GUEST_TEXTS } from "../../lib/server/imessage-receipts";
import { imessageHash } from "../../lib/server/photon-receiver";
import { decideHostProfileCommand, readHostProfileView, recordHostSessionMatch } from "../../lib/server/requester-host-profiles";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness, textOf } from "./support/imessage";
import { makeHostReady } from "./support/ready-host";
import { createTestRequest, jobFor, runJob, testNotices, testTokenKey } from "./support/requests";

// One account as host and guest in its linked iMessage (host-as-guest-messenger,
// testing baseline R01 M-1, M-2, M-4 to M-6, M-8; #334 and #61), against the
// local stack and the Photon stand-in: a request the host starts is bound to
// their host conversation and selected there, so free text reaches it without a
// picker; `setup` and `request <ref>` switch; a guest notice selects it again;
// words about a received request stay there and another host's link goes to
// the host role; a guest-host who opts in on
// the web gets the request in their host conversation; and nothing reaches the
// request's host.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const keys = { tokenKey: testTokenKey, tokenKeys: [testTokenKey] };
const noticeHandler = createImessageNoticeHandler(() => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] }));

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

// A set-up host with a linked iMessage, conflict calendars and a timezone.
async function linkedHost(displayName = "Grace Hopper") {
  const host = await hostWithUser(db);
  await makeHostReady(db, host.hostAccountId, { displayName });
  await db`
    update app.host_settings
    set settings = settings || ${db.json({ conflictCalendars: [{ accessRole: "owner", id: "grace@example.test", summary: "Personal" }], timezone: "Asia/Seoul" })}
    where host_account_id = ${host.hostAccountId}
  `;
  const { sender } = await im.link(host.hostAccountId);
  return { ...host, sender };
}

async function otherHost(displayName = "박도현") {
  const id = (await hostWithUser(db)).hostAccountId;
  return { hostAccountId: id, ...(await makeHostReady(db, id, { displayName })) };
}

// What start_request does once it has read the link: the account request, bound
// to the host conversation and selected there.
async function startFromConversation(hostAccountId: string, target: { hostAccountId: string }, name = "박도현") {
  return db.begin(async (tx) => {
    const account = (await readAccountRequester(tx, hostAccountId))!;
    const requestId = await createAccountRequest(tx, { origin: "http://localhost:3000", tokenKey: testTokenKey }, account, target.hostAccountId, randomUUID().replaceAll("-", "").padEnd(64, "0"), {}, {
      correlationId: randomUUID(),
      retryKey: randomUUID(),
    });
    await bindHostConversation(tx, keys, { hostAccountId, hostName: name, requestId, select: true, welcome: false });
    return requestId;
  });
}

async function guestInputs(requestId: string) {
  return (await db<{ message: string }[]>`
    select i.message from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'requester_request' and d.principal_id = ${requestId} and d.audience = 'requester'
    order by i.accepted_at
  `).map((row) => row.message);
}

async function hostInputs(hostAccountId: string) {
  return (await im.inputsOf(hostAccountId)).map((input) => input.message);
}

async function outboxOf(sender: string) {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where recipient_hash = ${imessageHash(testTokenKey, "sender", sender)} order by created_at, id
  `;
  return new Set(rows.map((row) => row.id));
}

async function sentTo(sender: string, before: ReadonlySet<string>) {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox
    where recipient_hash = ${imessageHash(testTokenKey, "sender", sender)} and state = 'queued'
    order by created_at, id
  `;
  const texts: string[] = [];
  for (const row of rows.filter((entry) => !before.has(entry.id))) texts.push(...textOf((await im.send(row.id)).sent));
  return texts;
}

describe("a request started from the host conversation", () => {
  it("is the account's, counts its calendars, and takes the host's next message without a picker", async () => {
    const host = await linkedHost();
    const target = await otherHost();
    const requestId = await startFromConversation(host.hostAccountId, target);

    const [request] = await db<{ requester_name: string; contact_confirmed_email: string | null; items: string[] }[]>`
      select r.requester_name, r.contact_confirmed_email, p.items
      from app.requests r join app.requester_host_profiles p on p.request_id = r.id where r.id = ${requestId}
    `;
    expect(request).toMatchObject({ items: ["calendars"], requester_name: "Grace Hopper" });
    expect(request!.contact_confirmed_email).toMatch(/@example\.test$/);
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).toBe(requestId);

    const before = await outboxOf(host.sender);
    expect((await im.deliver({ sender: host.sender, text: "Investment advice, Thursday afternoon" })).outcome).toBe("forwarded");
    expect(await guestInputs(requestId)).toEqual(["[iMessage] Investment advice, Thursday afternoon"]);
    expect(await hostInputs(host.hostAccountId)).toEqual([]);
    expect((await sentTo(host.sender, before)).join("\n")).not.toContain("Choose a conversation");

    // Nothing reaches the other host.
    expect(await hostInputs(target.hostAccountId)).toEqual([]);
    const [reached] = await db<{ count: number }[]>`
      select count(*)::int as count from app.imessage_outbox where host_account_id = ${target.hostAccountId}
    `;
    expect(reached!.count).toBe(0);
  });

  it("switches with setup and request <ref>, and saying they are the host goes to setup", async () => {
    const host = await linkedHost();
    const target = await otherHost();
    const requestId = await startFromConversation(host.hostAccountId, target);

    expect((await im.deliver({ sender: host.sender, text: "setup" })).outcome).toBe("command");
    await im.deliver({ sender: host.sender, text: "Make my meetings 45 minutes" });
    expect(await hostInputs(host.hostAccountId)).toContain("[iMessage] Make my meetings 45 minutes");
    expect(await guestInputs(requestId)).toEqual([]);

    const before = await outboxOf(host.sender);
    expect((await im.deliver({ sender: host.sender, text: `request ${requestRef(requestId)}` })).outcome).toBe("command");
    expect(await sentTo(host.sender, before)).toContain(GUEST_TEXTS.switched("박도현"));
    await im.deliver({ sender: host.sender, text: "Is Friday possible?" });
    expect(await guestInputs(requestId)).toEqual(["[iMessage] Is Friday possible?"]);

    expect((await im.deliver({ sender: host.sender, text: "I'm the host, show my settings" })).outcome).toBe("forwarded");
    expect(await hostInputs(host.hostAccountId)).toContain("[iMessage] I'm the host, show my settings");
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).toBeNull();
  });

  it("a guest notice selects the sent request again after the host moved to setup", async () => {
    const host = await linkedHost();
    const target = await otherHost();
    const requestId = await startFromConversation(host.hostAccountId, target);
    await im.deliver({ sender: host.sender, text: "setup" });
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).toBeNull();

    // The sent request's guest notice arrives in the same conversation and selects it.
    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, requestId, { kind: "status_declined" }).then(() => undefined));
    const before = await outboxOf(host.sender);
    await runJob(db, (await jobFor(db, IMESSAGE_NOTICE_JOB, guestNoticeKey(requestId, { kind: "status_declined" }))).id, noticeHandler);
    expect((await sentTo(host.sender, before)).join("\n")).toContain("박도현");
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).toBe(requestId);
  });

  it("keeps the host's words on a received request and sends another host's link to the host role", async () => {
    const host = await linkedHost();
    const target = await otherHost("Will Smith");
    const requestId = await startFromConversation(host.hostAccountId, target, "Will Smith");

    // On a received request, a word of the other host's name moves nothing.
    const received = await createTestRequest(db, { hostAccountId: host.hostAccountId });
    await db`update app.requests set state = 'gathering', identified_at = now() where id = ${received.requestId}`;
    await im.deliver({ sender: host.sender, text: `request ${requestRef(received.requestId)}` });
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).toBe(received.requestId);
    await im.deliver({ sender: host.sender, text: "I will approve it" });
    expect(await hostInputs(host.hostAccountId)).toContain("[iMessage] I will approve it");
    expect(await guestInputs(requestId)).toEqual([]);

    // On the sent request, another host's link goes to setup, where start_request reads it.
    await im.deliver({ sender: host.sender, text: `request ${requestRef(requestId)}` });
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).toBe(requestId);
    await im.deliver({ sender: host.sender, text: "Also book me with findmeatime.com/someone-else" });
    expect(await hostInputs(host.hostAccountId)).toContain("[iMessage] Also book me with findmeatime.com/someone-else");
    expect(await guestInputs(requestId)).toEqual([]);
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).toBeNull();
  });

  it("lists sent requests apart from received ones", async () => {
    const host = await linkedHost();
    const target = await otherHost();
    const requestId = await startFromConversation(host.hostAccountId, target);
    expect(await listSentRequests(db, host.hostAccountId)).toEqual([expect.objectContaining({ hostName: "박도현", requestId })]);
    expect(await listSentRequests(db, target.hostAccountId)).toEqual([]);
  });
});

// #61: a guest-host who opts in on the booking page.
describe("updates in the host conversation", () => {
  async function webGuestHost() {
    const host = await linkedHost("Eunwoo Lee");
    const target = await otherHost("Ada Lovelace");
    const request = await createTestRequest(db, { hostAccountId: target.hostAccountId });
    await db`update app.requests set state = 'gathering', identified_at = now() where id = ${request.requestId}`;
    const [user] = await db<{ auth_user_id: string }[]>`select auth_user_id from app.google_identities where host_account_id = ${host.hostAccountId}`;
    await db.begin((tx) => recordHostSessionMatch(tx, request.requestId, user!.auth_user_id));
    return { host, request, target };
  }

  function decide(requestId: string, input: unknown) {
    return runCommand({ authenticate: async () => ({ id: requestId, kind: "requester_request" }), db }, decideHostProfileCommand(keys) as never, {
      input,
      resourceId: requestId,
      retryKey: randomUUID(),
    });
  }

  it("binds the request to the host conversation, where request <ref> resolves only it", async () => {
    const { host, request, target } = await webGuestHost();
    expect((await readHostProfileView(db, request.requestId))?.messenger).toEqual({ offered: true, on: false });

    const before = await outboxOf(host.sender);
    expect((await decide(request.requestId, { items: [], messenger: true })).ok).toBe(true);
    expect((await readHostProfileView(db, request.requestId))?.messenger).toEqual({ offered: true, on: true });
    expect((await sentTo(host.sender, before)).join("\n")).toContain("Ada Lovelace");

    // Another host's request, with no binding here, does not resolve.
    const stranger = await createTestRequest(db, { hostAccountId: target.hostAccountId });
    await im.deliver({ sender: host.sender, text: `request ${requestRef(stranger.requestId)}` });
    expect((await im.bindingOf(host.hostAccountId))?.selected_request_id).not.toBe(stranger.requestId);

    expect((await im.deliver({ sender: host.sender, text: `request ${requestRef(request.requestId)}` })).outcome).toBe("command");
    await im.deliver({ sender: host.sender, text: "Mornings work for me" });
    expect(await guestInputs(request.requestId)).toEqual(["[iMessage] Mornings work for me"]);
    expect(await guestInputs(stranger.requestId)).toEqual([]);
    // Nothing reaches the request's host.
    expect(await hostInputs(target.hostAccountId)).toEqual([]);

    // Turning it off unlinks it again.
    expect((await decide(request.requestId, { items: [], messenger: false })).ok).toBe(true);
    expect((await readHostProfileView(db, request.requestId))?.messenger).toEqual({ offered: true, on: false });
  });
});
