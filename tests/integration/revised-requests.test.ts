import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUESTER_IMESSAGE_OPERATIONS } from "../../lib/contracts/requester-imessage";
import { REVISED_SUMMARY_PREFIX } from "../../lib/contracts/request";
import { type CommandDefinition, runCommand } from "../../lib/server/commands";
import { readHostRequest } from "../../lib/server/host-requests";
import { requestRef } from "../../lib/server/imessage-commands";
import { GUEST_TEXTS } from "../../lib/server/imessage-receipts";
import { imessageHash } from "../../lib/server/photon-receiver";
import {
  confirmRequesterImessageLinkCommand,
  createRequesterImessageLinkCommand,
  readRequesterImessageStatus,
} from "../../lib/server/requester-imessage-links";
import { REVISED_CHAIN_LIMIT } from "../../lib/server/revised-requests";
import { testDatabase } from "./support/database";
import { emailHarness } from "./support/email";
import { type FakeAgentMail, startFakeAgentMail } from "./support/fake-agentmail";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { readyHost } from "./support/guests";
import { imessageHarness, textOf } from "./support/imessage";
import { newSender, TEST_LINE } from "./support/photon";
import { createTestRequest, testTokenKey, uniqueEmail } from "./support/requests";

// Revised requests against the local stack, a fake AgentMail and the Photon
// stand-in (guest-flow-completion task 5.4): the bound guest's next message
// after a decline or an expiry starts one revised request with the same host,
// carrying the earlier details but no times, opening with a summary that holds
// nothing of the host's, and moves the channel there, so the next message goes
// to the revised discussion; a retried receipt creates nothing more; a full
// chain, an unavailable host and refused creation bounds create nothing and
// answer with the closed notice; and the host's view names the earlier request.

const db = testDatabase();
let photon: FakePhoton;
let agentmail: FakeAgentMail;
const im = imessageHarness(db, () => photon, {
  receipt: () => ({ creationLimits: { perSourceDay: 1000, perSourceHour: 1000, serviceDay: 100000 } }),
});
const email = emailHarness(db, () => agentmail);
const options = { lineNumber: TEST_LINE, tokenKey: testTokenKey, tokenKeys: [testTokenKey] };
const commands: Readonly<Record<string, CommandDefinition<unknown, unknown>>> = Object.fromEntries(
  [createRequesterImessageLinkCommand(options), confirmRequesterImessageLinkCommand(options)].map((command) => [
    command.operation,
    command as unknown as CommandDefinition<unknown, unknown>,
  ]),
);

beforeAll(async () => {
  photon = await startFakePhoton();
  agentmail = await startFakeAgentMail();
  await email.register();
});

afterAll(async () => {
  await photon.close();
  await agentmail.close();
  await db.end();
});

const DETAILS = {
  durationMinutes: 45,
  language: "en",
  linkPlan: null,
  location: "Room 301",
  mode: "in_person",
  purpose: "Thesis feedback",
  timezone: "Asia/Seoul",
  travelMode: "transit",
  windows: [{ end: "2026-11-02T03:00:00.000Z", start: "2026-11-02T01:00:00.000Z" }],
};

function asGuest(requestId: string, operation: string, input: unknown = {}) {
  return runCommand({ authenticate: async () => ({ id: requestId, kind: "requester_request" }), db }, commands[operation]!, {
    input,
    resourceId: requestId,
    retryKey: randomUUID(),
  });
}

// A ready host's request with details, the sender linked as its guest, closed as `state`.
async function closedGuestRequest(sender: string, state: "declined" | "expired") {
  const host = await readyHost(db);
  const request = await createTestRequest(db, { confirmed: true, hostAccountId: host.hostAccountId });
  await db`update app.requests set details = ${db.json(DETAILS)} where id = ${request.requestId}`;
  expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.create)).ok).toBe(true);
  const pending = await readRequesterImessageStatus(db, [testTokenKey], request.requestId, TEST_LINE);
  if (pending.state !== "pending") throw new Error("Expected a pending code.");
  await im.deliver({ sender, text: pending.message });
  const received = await readRequesterImessageStatus(db, [testTokenKey], request.requestId, TEST_LINE);
  if (received.state !== "received") throw new Error("Expected a received code.");
  expect((await asGuest(request.requestId, REQUESTER_IMESSAGE_OPERATIONS.confirm, { linkId: received.linkId })).ok).toBe(true);
  await db`update app.requests set state = ${state}, closed_at = now() where id = ${request.requestId}`;
  return { ...request, host };
}

async function revisionOf(requestId: string) {
  const [row] = await db<{ id: string; state: string; details: typeof DETAILS; requester_name: string; contact_email: string; contact_confirmed_email: string | null }[]>`
    select id, state, details, requester_name, contact_email, contact_confirmed_email from app.requests where revised_from_request_id = ${requestId}
  `;
  return row ?? null;
}

async function inputsOf(requestId: string) {
  return (await email.inputsOf(requestId)).map((input) => input.message);
}

describe("a revised request by iMessage", () => {
  it("starts one revised request after a decline, carrying the details but no times, and moves the conversation", async () => {
    const sender = newSender();
    const earlier = await closedGuestRequest(sender, "declined");

    const receiptId = await im.store({ sender, text: "Could we try the week after?" });
    await im.processTwice(receiptId);

    const revised = await revisionOf(earlier.requestId);
    expect(revised).toMatchObject({
      contact_confirmed_email: earlier.contactEmail,
      contact_email: earlier.contactEmail,
      requester_name: "Grace Hopper",
      state: "gathering",
    });
    expect(revised!.details).toMatchObject({ durationMinutes: 45, location: "Room 301", mode: "in_person", purpose: "Thesis feedback", travelMode: "transit", windows: [] });
    expect(await db`select 1 from app.requests where revised_from_request_id = ${earlier.requestId}`).toHaveLength(1);

    // A new booking link, sent by the creation email.
    const deliveries = await db<{ kind: string }[]>`select kind from app.email_deliveries where request_id = ${revised!.id}`;
    expect(deliveries.map((delivery) => delivery.kind)).toEqual(["request_creation"]);

    // The discussion opens with the summary, then the guest's message.
    const inputs = await inputsOf(revised!.id);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain(REVISED_SUMMARY_PREFIX);
    expect(inputs[0]).toContain(`request ${requestRef(earlier.requestId)} was declined by the host`);
    expect(inputs[0]).toContain("Purpose: Thesis feedback");
    expect(inputs[0]).not.toContain("2026-11-02");
    expect(inputs[1]).toBe("[iMessage] Could we try the week after?");

    const bindings = await db<{ request_id: string; state: string }[]>`
      select request_id, state from app.requester_imessage_bindings
      where sender_hash = ${imessageHash(testTokenKey, "sender", sender)} order by created_at
    `;
    expect(bindings).toEqual([
      { request_id: earlier.requestId, state: "moved" },
      { request_id: revised!.id, state: "active" },
    ]);

    // The next message goes to the revised discussion.
    expect((await im.deliver({ sender, text: "Mornings are best." })).outcome).toBe("forwarded");
    expect(await inputsOf(revised!.id)).toHaveLength(3);
    expect(await db`select 1 from app.requests where revised_from_request_id = ${revised!.id}`).toHaveLength(0);

    // The host's view and summary name the earlier request.
    const view = await readHostRequest(db, earlier.hostAccountId, revised!.id);
    expect(view?.revisedFrom).toEqual({ outcome: "declined", ref: requestRef(earlier.requestId) });
  });

  it("answers with the closed notice and creates nothing when the chain is full, the host is unavailable or the bounds refuse", async () => {
    const full = newSender();
    const last = await closedGuestRequest(full, "expired");
    let previous: string | null = null;
    for (let index = 0; index < REVISED_CHAIN_LIMIT - 1; index += 1) {
      const link = await createTestRequest(db, { hostAccountId: last.hostAccountId });
      await db`update app.requests set state = 'declined', closed_at = now(), revised_from_request_id = ${previous} where id = ${link.requestId}`;
      previous = link.requestId;
    }
    await db`update app.requests set revised_from_request_id = ${previous} where id = ${last.requestId}`;
    expect((await im.deliver({ sender: full, text: "One more try?" })).outcome).toBe("replied");
    expect(await revisionOf(last.requestId)).toBeNull();

    const suspended = newSender();
    const unavailable = await closedGuestRequest(suspended, "declined");
    await db`update app.host_accounts set status = 'suspended' where id = ${unavailable.hostAccountId}`;
    expect((await im.deliver({ sender: suspended, text: "Hello again" })).outcome).toBe("replied");
    expect(await revisionOf(unavailable.requestId)).toBeNull();

    const bounded = newSender();
    const limited = await closedGuestRequest(bounded, "declined");
    const deps = { ...im.receiptDeps(), creationLimits: { perSourceDay: 0, perSourceHour: 0, serviceDay: 0 } };
    expect((await im.deliver({ sender: bounded, text: "Hello again" }, deps)).outcome).toBe("replied");
    expect(await revisionOf(limited.requestId)).toBeNull();

    const [notice] = await im.outbox({ recipientHash: imessageHash(testTokenKey, "sender", bounded), kind: "command" });
    expect(textOf((await im.send(notice!.id)).sent)).toEqual([GUEST_TEXTS.closed]);
  });
});

describe("a revised request by email", () => {
  it("starts one revised request from the bound thread after an expiry, and the next reply goes there", async () => {
    const host = await readyHost(db);
    const address = uniqueEmail("revised");
    const first = await email.deliver({ from: `Grace Hopper <${address}>`, subject: `Meeting with @${host.handle}`, text: "Could we meet next week?" });
    const binding = (await email.bindingOf(first.message.thread_id))!;
    await db`update app.requests set state = 'expired', closed_at = now() where id = ${binding.request_id}`;

    const reply = (text: string) => email.deliver({ from: `Grace Hopper <${address}>`, inReplyTo: first.message.message_id, text, threadId: first.message.thread_id });
    expect((await reply("Sorry I missed it. Can we try again?")).outcome).toBe("forwarded");

    const revised = await revisionOf(binding.request_id);
    expect(revised).toMatchObject({ contact_email: address, state: "gathering" });
    expect(await email.bindingOf(first.message.thread_id)).toMatchObject({ request_id: revised!.id, state: "active" });
    const inputs = await inputsOf(revised!.id);
    expect(inputs[0]).toContain("expired, and the guest wrote again");
    expect(inputs[1]).toBe("Sorry I missed it. Can we try again?");

    expect((await reply("Tuesday works.")).outcome).toBe("forwarded");
    expect(await inputsOf(revised!.id)).toHaveLength(3);
    expect(await db`select 1 from app.requests where revised_from_request_id = ${binding.request_id}`).toHaveLength(1);
  });
});
