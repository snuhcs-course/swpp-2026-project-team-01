import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { declineRequestForTool, resolveChangesForTool } from "../../lib/server/host-review-tools";
import { requestRef } from "../../lib/server/imessage-commands";
import { sessionIdHash } from "../../lib/server/model-limits";
import { readSetupState } from "../../lib/server/setup";
import { confirmSettingsForTool, listHostRequestsForSetupTool } from "../../lib/server/setup-channel-tools";
import { settingsRef } from "../../lib/server/request-ref";
import { suggestChangesCommand } from "../../lib/server/shared-changes";
import { agreedRequest, asHost } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { createTestRequest, testNotices } from "./support/requests";
import { prepareReviewableHost, seedHost, setupDependencies } from "./support/setup-host";

// The host's actions in their own words from the linked conversation
// (channel-actions-in-words D1, issue #148): decline_request, share_changes,
// dismiss_changes and confirm_settings act only while the turn answers a
// message from the linked iMessage, WhatsApp or Telegram, only on what the
// host was shown (the current version, the pending suggestion, the current
// settings review), only on an open request, and once. list_host_requests
// answers in setup on the web too (#138).

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
let setupDeps: ReturnType<typeof setupDependencies>;
const im = imessageHarness(db, () => photon, { receipt: () => ({ setup: setupDeps }) });
const notices = () => testNotices;

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
  setupDeps = setupDependencies(db, google);
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

// The session answering the latest input of the host's discussion, as the
// runtime would have started it, and the tool call it makes.
async function sessionFor(hostAccountId: string, audience: "host_review" | "host_setup", requestId: string | null) {
  const [discussion] = await db<{ id: string }[]>`
    select id from app.discussions
    where principal_type = 'host_account' and principal_id = ${hostAccountId} and audience = ${audience}
      and request_id is not distinct from ${requestId}
  `;
  const [input] = await db<{ id: string }[]>`
    select id from app.conversation_inputs where discussion_id = ${discussion!.id} order by accepted_at desc limit 1
  `;
  const [existing] = await db<{ session_id: string }[]>`
    select session_id from app.agent_sessions where discussion_id = ${discussion!.id} and state = 'active' order by generation desc limit 1
  `;
  let sessionId = existing?.session_id;
  if (sessionId) {
    await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${sessionId}`;
  } else {
    sessionId = `session_${randomUUID()}`;
    await db`
      insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version, current_input_id)
      values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussion!.id}, 'host_account', ${hostAccountId}, 1, 'test', ${input!.id})
    `;
  }
  const attributes: Record<string, string> = { audience, discussionId: discussion!.id, generation: "1" };
  if (requestId) attributes.requestId = requestId;
  return {
    call: { auth: { attributes, principalId: hostAccountId, principalType: "user" as const }, callId: randomUUID(), sessionId },
    inputId: input!.id,
  };
}

// A linked host with an agreed proposal, who selected the request and wrote `text` from iMessage.
async function reviewerWrote(text: string) {
  const request = await agreedRequest(db, google);
  const { sender } = await im.link(request.hostAccountId);
  await im.deliver({ sender, text: `request ${requestRef(request.requestId)}` });
  expect((await im.deliver({ sender, text })).outcome).toBe("forwarded");
  return { ...(await sessionFor(request.hostAccountId, "host_review", request.requestId)), request, sender };
}

async function typedOnTheWeb(inputId: string, text: string) {
  await db`update app.conversation_inputs set message = ${text} where id = ${inputId}`;
}

async function stateOf(requestId: string) {
  const [row] = await db<{ state: string }[]>`select state from app.requests where id = ${requestId}`;
  return row!.state;
}

async function suggest(hostAccountId: string, requestId: string, start: string) {
  const later = new Date(new Date(start).getTime() + 60 * 60_000).toISOString();
  const outcome = await asHost(db, hostAccountId, requestId, suggestChangesCommand("assistant"), { changes: { start: later } });
  expect(outcome.ok).toBe(true);
  const [draft] = await db<{ id: string }[]>`select id from app.shared_change_drafts where request_id = ${requestId} and state = 'pending'`;
  return draft!.id;
}

async function suggestionState(id: string) {
  const [row] = await db<{ state: string }[]>`select state from app.shared_change_drafts where id = ${id}`;
  return row!.state;
}

describe("declining in words", () => {
  it("declines the request for a message from iMessage, once", async () => {
    const { call, request } = await reviewerWrote("I can't take this one, decline it");

    expect(await declineRequestForTool(db, call, { version: 1 }, notices)).toMatchObject({ declined: true, message: expect.stringContaining("Declined") });
    expect(await stateOf(request.requestId)).toBe("declined");

    const again = await declineRequestForTool(db, { ...call, callId: randomUUID() }, { version: 1 }, notices);
    expect(again).toMatchObject({ declined: true, message: expect.stringContaining("already declined") });
  });

  it("declines nothing for a message typed on the web", async () => {
    const { call, inputId, request } = await reviewerWrote("Decline it");
    await typedOnTheWeb(inputId, "Decline it");

    expect(await declineRequestForTool(db, call, { version: 1 }, notices)).toMatchObject({ declined: false, problem: expect.stringContaining("presses Decline") });
    expect(await stateOf(request.requestId)).toBe("awaiting_host_approval");
  });

  it("declines nothing for a web message that starts with a channel prefix", async () => {
    const { call, inputId, request } = await reviewerWrote("Decline it");
    // Typed in /app: no receipt carries this input.
    await db`update app.conversation_inputs set message = '[iMessage] Decline it', client_input_id = ${randomUUID()} where id = ${inputId}`;

    expect(await declineRequestForTool(db, call, { version: 1 }, notices)).toMatchObject({ declined: false });
    expect(await stateOf(request.requestId)).toBe("awaiting_host_approval");
  });

  it("declines nothing for a version that is not the current proposal", async () => {
    const { call, request } = await reviewerWrote("Decline it");

    expect(await declineRequestForTool(db, call, { version: 2 }, notices)).toMatchObject({ declined: false, problem: expect.stringContaining("version 1") });
    expect(await declineRequestForTool(db, call, { version: null }, notices)).toMatchObject({ declined: false });
    expect(await stateOf(request.requestId)).toBe("awaiting_host_approval");
  });

  it("declines nothing once the request is closed", async () => {
    const { call, request } = await reviewerWrote("Decline it");
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${request.requestId}`;

    expect(await declineRequestForTool(db, call, { version: 1 }, notices)).toMatchObject({ declined: false, problem: expect.stringContaining("closed") });
    expect(await stateOf(request.requestId)).toBe("withdrawn");
  });
});

describe("sharing or dismissing suggested changes in words", () => {
  it("shares the pending suggestion for a message from iMessage, once", async () => {
    const { call, request } = await reviewerWrote("Yes, send them the new time");
    const id = await suggest(request.hostAccountId, request.requestId, request.start);

    expect(await resolveChangesForTool(db, call, "share", { suggestionId: id })).toMatchObject({ done: true, message: expect.stringContaining("Shared") });
    expect(await suggestionState(id)).toBe("checking");

    const again = await resolveChangesForTool(db, { ...call, callId: randomUUID() }, "share", { suggestionId: id });
    expect(again).toMatchObject({ done: true, message: expect.stringContaining("already shared") });
    expect(await suggestionState(id)).toBe("checking");
  });

  it("dismisses the pending suggestion for a message from iMessage, once", async () => {
    const { call, request } = await reviewerWrote("Never mind, drop those");
    const id = await suggest(request.hostAccountId, request.requestId, request.start);

    expect(await resolveChangesForTool(db, call, "dismiss", { suggestionId: id })).toMatchObject({ done: true });
    expect(await suggestionState(id)).toBe("dismissed");
    expect(await resolveChangesForTool(db, { ...call, callId: randomUUID() }, "dismiss", { suggestionId: id })).toMatchObject({
      done: true,
      message: expect.stringContaining("already dismissed"),
    });
  });

  it("shares nothing for a message typed on the web", async () => {
    const { call, inputId, request } = await reviewerWrote("Send it");
    const id = await suggest(request.hostAccountId, request.requestId, request.start);
    await typedOnTheWeb(inputId, "Send it");

    expect(await resolveChangesForTool(db, call, "share", { suggestionId: id })).toMatchObject({ done: false, problem: expect.stringContaining("Share revised details") });
    expect(await resolveChangesForTool(db, call, "dismiss", { suggestionId: id })).toMatchObject({ done: false });
    expect(await suggestionState(id)).toBe("pending");
  });

  it("shares nothing for a suggestion that is not the current one", async () => {
    const { call, request } = await reviewerWrote("Send it");
    await suggest(request.hostAccountId, request.requestId, request.start);

    expect(await resolveChangesForTool(db, call, "share", { suggestionId: randomUUID() })).toMatchObject({
      done: false,
      problem: expect.stringContaining("not the current suggested changes"),
    });
  });

  it("shares nothing once the request is closed", async () => {
    const { call, request } = await reviewerWrote("Send it");
    const id = await suggest(request.hostAccountId, request.requestId, request.start);
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${request.requestId}`;

    expect(await resolveChangesForTool(db, call, "share", { suggestionId: id })).toMatchObject({ done: false, problem: expect.stringContaining("closed") });
    expect(await resolveChangesForTool(db, call, "dismiss", { suggestionId: id })).toMatchObject({ done: false });
    expect(await suggestionState(id)).toBe("pending");
  });
});

describe("setup in words", () => {
  async function setupHostWrote(text: string) {
    const host = await seedHost(db, setupDeps, google);
    await prepareReviewableHost(db, host);
    const { sender } = await im.link(host.hostAccountId);
    expect((await im.deliver({ sender, text })).outcome).toBe("forwarded");
    const session = await sessionFor(host.hostAccountId, "host_setup", null);
    const state = await readSetupState(setupDeps, host.hostAccountId);
    return { ...session, host, reviewRef: settingsRef(state!.proposalHash) };
  }

  async function saved(hostAccountId: string) {
    return (await db`select 1 from app.host_settings where host_account_id = ${hostAccountId}`).length;
  }

  it("saves the current settings review for a message from iMessage, once", async () => {
    const { call, host, reviewRef } = await setupHostWrote("Looks right, save it");

    const confirmed = await confirmSettingsForTool(setupDeps, call, { reviewRef });
    expect(confirmed).toMatchObject({ saved: true, links: { booking: expect.stringMatching(/^https:\/\/findmeatime\.test\//) } });
    expect(await saved(host.hostAccountId)).toBe(1);

    const again = await confirmSettingsForTool(setupDeps, { ...call, callId: randomUUID() }, { reviewRef });
    expect(again).toMatchObject({ message: "These settings are already saved.", saved: true });
  });

  it("saves nothing for a message typed on the web", async () => {
    const { call, host, inputId, reviewRef } = await setupHostWrote("Save it");
    await typedOnTheWeb(inputId, "Save it");

    expect(await confirmSettingsForTool(setupDeps, call, { reviewRef })).toMatchObject({ problem: expect.stringContaining("Confirm and save"), saved: false });
    expect(await saved(host.hostAccountId)).toBe(0);
  });

  it("saves nothing for a review that is not the current one", async () => {
    const { call, host, reviewRef } = await setupHostWrote("Save it");

    expect(await confirmSettingsForTool(setupDeps, call, { reviewRef: "00000000" })).toMatchObject({
      problem: expect.stringContaining(`the current one is ${reviewRef}`),
      saved: false,
    });
    expect(await saved(host.hostAccountId)).toBe(0);
  });

  it("lists the host's requests in setup, on the web too (#138)", async () => {
    const { call, host, inputId } = await setupHostWrote("Do I have any requests?");
    await typedOnTheWeb(inputId, "Do I have any requests?");
    const request = await createTestRequest(db, { hostAccountId: host.hostAccountId });

    const listed = await listHostRequestsForSetupTool(setupDeps, call);
    expect(listed.requests).toEqual([expect.objectContaining({ ref: requestRef(request.requestId), state: expect.any(String) })]);
  });
});
