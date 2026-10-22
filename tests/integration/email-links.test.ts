import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailLinkStatus } from "../../lib/contracts/email-link";
import { runCommand } from "../../lib/server/commands";
import { createEmailLinkCommand, unlinkEmailCommand } from "../../lib/server/email-links";
import { createEmailLinkStatusHandler, createRequesterCommandHandler } from "../../lib/server/requester-routes";
import { testDatabase } from "./support/database";
import { emailHarness } from "./support/email";
import { type FakeAgentMail, startFakeAgentMail } from "./support/fake-agentmail";
import { call, guestDependencies } from "./support/guests";
import { closeTestRequest, createTestRequest, testTokenKey, uniqueEmail } from "./support/requests";
import { makeHostReady, newHostAccount } from "./support/ready-host";

// Continue by email (requester-email-channel design 4; task 4.1): a code needs a
// confirmed contact, is shown again after a reload, and binds a thread only as
// the first message of a new thread from that address with authenticated
// evidence before it expires. A forwarded, unauthenticated, late or in-thread
// copy voids it. The linking message never reaches the model, the thread gets a
// fixed confirmation, a new link replaces the earlier thread, and unlinking
// works without AgentMail.

const db = testDatabase();
let agentmail: FakeAgentMail;
const email = emailHarness(db, () => agentmail);
const { bindingOf, deliver, inbox, inputsOf, repliesFor, runReply } = email;

beforeAll(async () => {
  agentmail = await startFakeAgentMail();
  await email.register();
});

afterAll(async () => {
  await agentmail?.close();
  await db.end();
});

async function linkableRequest(options: { confirmed?: boolean } = {}) {
  const hostAccountId = await newHostAccount(db);
  await makeHostReady(db, hostAccountId, { displayName: "Ada Lovelace" });
  return createTestRequest(db, { confirmed: options.confirmed ?? true, contactEmail: uniqueEmail("linker"), hostAccountId });
}

function asRequester<Input, Result>(
  requestId: string,
  command: Parameters<typeof runCommand<Input, Result>>[1],
  retryKey = randomUUID(),
  input: unknown = {},
) {
  return runCommand({ authenticate: async () => ({ id: requestId, kind: "requester_request" }), db }, command, {
    input,
    resourceId: requestId,
    retryKey,
  });
}

const deps = () => guestDependencies(db, { emailInbox: inbox });

async function status(bookingId: string) {
  const response = await call(createEmailLinkStatusHandler(deps), { bookingId }, `/api/requests/${bookingId}/email-link`);
  return { body: (await response.json()) as EmailLinkStatus, status: response.status };
}

async function createCode(request: { requestId: string; bookingId: string }) {
  const outcome = await asRequester(request.requestId, createEmailLinkCommand({ tokenKey: testTokenKey }));
  expect(outcome.ok).toBe(true);
  const { body } = await status(request.bookingId);
  if (body.state !== "pending") throw new Error(`Expected a pending code, got ${body.state}.`);
  return body.code;
}

describe("creating a code", () => {
  it("asks for a confirmed address first", async () => {
    const request = await linkableRequest({ confirmed: false });
    expect((await status(request.bookingId)).body).toEqual({ inbox, state: "needs_confirmation" });
    const outcome = await asRequester(request.requestId, createEmailLinkCommand({ tokenKey: testTokenKey }));
    expect(outcome).toMatchObject({ error: { category: "invalid_input" }, ok: false });
  });

  it("shows the pending code again after a reload, and an exact retry keeps it", async () => {
    const request = await linkableRequest();
    expect((await status(request.bookingId)).body).toEqual({ inbox, state: "none" });

    const retryKey = randomUUID();
    const first = await asRequester(request.requestId, createEmailLinkCommand({ tokenKey: testTokenKey }), retryKey);
    const again = await asRequester(request.requestId, createEmailLinkCommand({ tokenKey: testTokenKey }), retryKey);
    expect(again).toMatchObject({ ok: true, replayed: true, result: first.ok ? first.result : null });

    const shown = (await status(request.bookingId)).body;
    expect(shown).toMatchObject({ inbox, state: "pending" });
    expect((shown as { code: string }).code).toMatch(/^FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect((await status(request.bookingId)).body).toEqual(shown);

    // The stored row holds a hash and a sealed copy, not the code.
    const [row] = await db<{ code_hash: string; code_ciphertext: string }[]>`select code_hash, code_ciphertext from app.email_links where request_id = ${request.requestId}`;
    expect(JSON.stringify(row)).not.toContain((shown as { code: string }).code);
  });

  it("goes through the booking page's commands route and is bounded per hour", async () => {
    const request = await linkableRequest();
    const handler = createRequesterCommandHandler(deps);
    const post = (retryKey: string) =>
      call(handler, { bookingId: request.bookingId }, `/api/requests/${request.bookingId}/commands`, {
        body: { input: {}, operation: "request.email_link.create", retryKey },
        method: "POST",
      });

    for (let index = 0; index < 5; index += 1) expect((await post(randomUUID())).status).toBe(200);
    expect((await post(randomUUID())).status).toBe(429);
    const [count] = await db<{ pending: number }[]>`select count(*) filter (where state = 'pending')::int as pending from app.email_links where request_id = ${request.requestId}`;
    expect(count!.pending).toBe(1);
  });

  it("is unavailable without an inbox", async () => {
    const request = await linkableRequest();
    const response = await call(createEmailLinkStatusHandler(() => guestDependencies(db, { emailInbox: "" })), { bookingId: request.bookingId }, "/x");
    expect(await response.json()).toEqual({ state: "unavailable" });
  });
});

describe("binding by code", () => {
  it("binds a new thread from the confirmed address, never forwarding the linking message", async () => {
    const request = await linkableRequest();
    const code = await createCode(request);
    const { message, outcome } = await deliver({ from: `Grace <${request.contactEmail}>`, subject: code, text: code });

    expect(outcome).toBe("linked");
    const binding = await bindingOf(message.thread_id);
    expect(binding).toMatchObject({ origin: "linked", request_id: request.requestId, state: "active" });
    expect(await inputsOf(request.requestId)).toEqual([]);
    expect((await status(request.bookingId)).body).toMatchObject({ inbox, state: "linked" });

    const [confirmation] = await repliesFor(message.thread_id);
    expect(confirmation!.kind).toBe("link_confirmation");
    expect(await runReply(confirmation!.id)).toBe("completed");
    expect(agentmail.repliesIn(message.thread_id)[0]!.text).toBe("This thread is now linked to your request with Ada Lovelace. Reply here to continue.");

    // The bound sender's next message is forwarded.
    const next = await deliver({ from: `Grace <${request.contactEmail}>`, inReplyTo: message.message_id, text: "Thursday works.", threadId: message.thread_id });
    expect(next.outcome).toBe("forwarded");
    expect((await inputsOf(request.requestId)).map((input) => input.message)).toEqual(["Thursday works."]);
  });

  it("forwards later replies whose subject or quoted text repeats the code, with the code removed", async () => {
    const request = await linkableRequest();
    const code = await createCode(request);
    const { message } = await deliver({ from: `Grace <${request.contactEmail}>`, subject: code, text: code });

    // What a mail client sends: "Re:" and the earlier message quoted, with no
    // extracted new text.
    const reply = await deliver({
      from: `Grace <${request.contactEmail}>`,
      inReplyTo: message.message_id,
      subject: `Re: ${code}`,
      text: `Thursday works.\n\nOn Tue, Grace wrote:\n> ${code}`,
      threadId: message.thread_id,
    });

    expect(reply.outcome).toBe("forwarded");
    const inputs = await inputsOf(request.requestId);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.message).toContain("Thursday works.");
    expect(inputs[0]!.message).not.toContain(code);
    expect((await bindingOf(message.thread_id))!.state).toBe("active");
  });

  it("voids another pending code seen in a bound thread", async () => {
    const request = await linkableRequest();
    const { message } = await deliver({ from: `Grace <${request.contactEmail}>`, subject: "x", text: await createCode(request) });
    const other = await linkableRequest();
    const otherCode = await createCode(other);

    const leaked = await deliver({ from: `Grace <${request.contactEmail}>`, inReplyTo: message.message_id, text: `Is this right? ${otherCode}`, threadId: message.thread_id });
    expect(leaked.outcome).toBe("forwarded");
    expect((await status(other.bookingId)).body).toEqual({ inbox, state: "none" });
  });

  it.each([
    ["another sender (a forwarded copy)", { from: () => `Someone <${uniqueEmail("fwd")}>` }],
    ["an unauthenticated message", { authenticated: false }],
    ["a message in an existing thread", { inReplyTo: "<earlier@example.test>" }],
  ])("voids the code when it arrives from %s", async (_name, variant) => {
    const request = await linkableRequest();
    const code = await createCode(request);
    const { message, outcome } = await deliver({
      authenticated: "authenticated" in variant ? variant.authenticated : true,
      from: "from" in variant ? variant.from() : `Grace <${request.contactEmail}>`,
      inReplyTo: "inReplyTo" in variant ? variant.inReplyTo : undefined,
      subject: `Fwd: ${code}`,
      text: `Forwarded message: ${code}`,
    });

    expect(outcome).toBe("ignored");
    expect(await bindingOf(message.thread_id)).toBeNull();
    expect(await repliesFor(message.thread_id)).toEqual([]);
    expect(await inputsOf(request.requestId)).toEqual([]);
    expect((await status(request.bookingId)).body).toEqual({ inbox, state: "none" });

    // The voided code no longer binds even as written.
    const retry = await deliver({ from: `Grace <${request.contactEmail}>`, subject: code, text: code });
    expect(retry.outcome).toBe("ignored");
  });

  it("refuses an expired code and a closed request", async () => {
    const expired = await linkableRequest();
    const code = await createCode(expired);
    await db`update app.email_links set expires_at = now() - interval '1 minute' where request_id = ${expired.requestId}`;
    expect((await deliver({ from: `Grace <${expired.contactEmail}>`, subject: code, text: code })).outcome).toBe("ignored");

    const closed = await linkableRequest();
    const closedCode = await createCode(closed);
    await closeTestRequest(db, closed.requestId);
    expect((await deliver({ from: `Grace <${closed.contactEmail}>`, subject: closedCode, text: closedCode })).outcome).toBe("ignored");
  });

  it("replaces the earlier thread when linking again, and unlinks without AgentMail", async () => {
    const request = await linkableRequest();
    const first = await deliver({ from: `Grace <${request.contactEmail}>`, subject: "x", text: await createCode(request) });
    const second = await deliver({ from: `Grace <${request.contactEmail}>`, subject: "x", text: await createCode(request) });
    expect((await bindingOf(first.message.thread_id))!.state).toBe("unlinked");
    expect((await bindingOf(second.message.thread_id))!.state).toBe("active");

    // Cancelling a new code keeps the linked thread.
    await createCode(request);
    expect(await asRequester(request.requestId, unlinkEmailCommand(), randomUUID(), { pendingOnly: true })).toMatchObject({ result: { unlinked: false } });
    expect((await bindingOf(second.message.thread_id))!.state).toBe("active");
    expect((await status(request.bookingId)).body).toMatchObject({ state: "linked" });

    // AgentMail is unreachable: unlinking still ends the binding.
    await agentmail.close();
    try {
      const outcome = await asRequester(request.requestId, unlinkEmailCommand());
      expect(outcome).toMatchObject({ ok: true, result: { unlinked: true } });
    } finally {
      agentmail = await startFakeAgentMail();
    }

    expect((await bindingOf(second.message.thread_id))!.state).toBe("unlinked");
    expect((await status(request.bookingId)).body).toEqual({ inbox, state: "none" });
    const late = await deliver({ from: `Grace <${request.contactEmail}>`, inReplyTo: second.message.message_id, text: "Hello?", threadId: second.message.thread_id });
    expect(late.outcome).toBe("ignored");
  });

  it("is idempotent when the receipt job runs again", async () => {
    const request = await linkableRequest();
    const code = await createCode(request);
    const { message, receiptId } = await deliver({ from: `Grace <${request.contactEmail}>`, subject: code, text: code });
    await db`update app.email_receipts set outcome = null, processed_at = null where id = ${receiptId}`;
    const { createEmailReceiptHandler } = await import("../../lib/server/email-receipts");
    const outcome = await db.begin((tx) =>
      createEmailReceiptHandler(() => email.receiptDeps())(tx, { attempts: 2, fence: 0, id: randomUUID(), kind: "email_receipt", maxAttempts: 10, payload: { receiptId } }),
    );
    expect(outcome).toMatchObject({ outcome: "linked" });
    expect(await repliesFor(message.thread_id)).toHaveLength(1);
  });
});
