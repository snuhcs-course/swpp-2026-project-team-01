import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueStatusNotice } from "../../lib/server/booking-notices";
import { testDatabase } from "./support/database";
import { emailHarness } from "./support/email";
import { type FakeAgentMail, startFakeAgentMail } from "./support/fake-agentmail";
import { readyHost } from "./support/guests";
import { testNotices, uniqueEmail } from "./support/requests";

// Status notices from the product inbox (requester-email-channel design 7,
// guest-flow-completion U15): a request with a bound thread gets each status
// notice in that thread, replying to its latest message, with no booking link
// and no no-reply email; one with no thread gets it as the first message of a
// new thread, which is then bound to the request so the guest's reply reaches
// it; without an inbox the notice is the no-reply email with the link; a notice
// whose thread was unlinked, or whose condition no longer holds, is suppressed.

const db = testDatabase();
let agentmail: FakeAgentMail;
const email = emailHarness(db, () => agentmail);
const { bindingOf, deliver, inbox, runReply } = email;
const inboxNotices = { ...testNotices, inboxId: inbox };

beforeAll(async () => {
  agentmail = await startFakeAgentMail();
  await email.register();
});

afterAll(async () => {
  await agentmail?.close();
  await db.end();
});

async function emailRequest() {
  const host = await readyHost(db);
  const address = uniqueEmail("notice");
  const { message } = await deliver({ from: `Grace <${address}>`, subject: `Meeting with @${host.handle}`, text: "Can we meet?" });
  const binding = (await bindingOf(message.thread_id))!;
  return { address, binding, message };
}

async function decline(requestId: string) {
  await db`update app.requests set state = 'declined', closed_at = now() where id = ${requestId}`;
  await db.begin((tx) => enqueueStatusNotice(tx, inboxNotices, requestId, { kind: "status_declined" }));
}

async function notices(requestId: string) {
  return db<{ id: string; state: string; text: string | null; secret_ciphertext: string | null; reply_to_message_id: string | null; binding_id: string | null }[]>`
    select id, state, text, secret_ciphertext, reply_to_message_id, binding_id from app.email_replies where request_id = ${requestId} and kind = 'notice'
  `;
}

describe("thread notices", () => {
  it("sends the decline notice in the thread, with no link and no no-reply email", async () => {
    const { binding, message } = await emailRequest();
    await decline(binding.request_id);

    const [notice] = await notices(binding.request_id);
    expect(notice).toMatchObject({ reply_to_message_id: message.message_id, state: "queued", text: null });
    expect(notice!.secret_ciphertext).not.toBeNull();
    const deliveries = await db<{ kind: string; recipients: string[] }[]>`
      select kind, recipients from app.email_deliveries where request_id = ${binding.request_id} and kind = 'status_declined'
    `;
    expect(deliveries).toEqual([]);

    expect(await runReply(notice!.id)).toBe("completed");
    const [sent] = agentmail.repliesIn(message.thread_id);
    expect(sent!.inReplyTo).toBe(message.message_id);
    expect(sent!.text).toMatch(/declined/i);
    expect(sent!.text).not.toMatch(/\/booking\//);
    expect(sent!.text).toContain("Reply to this email to continue with Thyme.");

    const [after] = await notices(binding.request_id);
    expect(after).toMatchObject({ secret_ciphertext: null, state: "accepted", text: null });
  });

  it("sends the same notice again under the same key after a lost response", async () => {
    const { binding, message } = await emailRequest();
    await decline(binding.request_id);
    const [notice] = await notices(binding.request_id);

    agentmail.nextReply("drop");
    expect(await runReply(notice!.id)).toBe("failed");
    const [dispatching] = await notices(binding.request_id);
    expect(dispatching).toMatchObject({ state: "dispatching", text: null });
    expect(dispatching!.secret_ciphertext).not.toBeNull();

    expect(await runReply(notice!.id)).toBe("completed");
    const attempts = agentmail.attempts.filter((attempt) => attempt.idempotencyKey === notice!.id);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.text).toBe(attempts[1]!.text);
    expect(agentmail.repliesIn(message.thread_id)).toHaveLength(1);

    // Recording the same notice again makes no second reply.
    await db.begin((tx) => enqueueStatusNotice(tx, inboxNotices, binding.request_id, { kind: "status_declined" }));
    expect(await notices(binding.request_id)).toHaveLength(1);
  });

  it("suppresses the thread copy after unlinking, and a notice no longer current", async () => {
    const unlinked = await emailRequest();
    await decline(unlinked.binding.request_id);
    await db`update app.email_threads set state = 'unlinked', ended_at = now() where id = ${unlinked.binding.id}`;
    const [first] = await notices(unlinked.binding.request_id);
    expect(await runReply(first!.id)).toBe("completed");
    expect((await notices(unlinked.binding.request_id))[0]!.state).toBe("suppressed");
    expect(agentmail.repliesIn(unlinked.message.thread_id)).toHaveLength(0);

    const reopened = await emailRequest();
    await decline(reopened.binding.request_id);
    // The decline no longer holds when the notice is dispatched.
    await db`update app.requests set state = 'gathering', closed_at = null where id = ${reopened.binding.request_id}`;
    const [second] = await notices(reopened.binding.request_id);
    expect(await runReply(second!.id)).toBe("completed");
    expect((await notices(reopened.binding.request_id))[0]!.state).toBe("suppressed");
  });

  it("starts a thread for a request without one, binds it, and the guest's reply reaches the request", async () => {
    const { address, binding } = await emailRequest();
    await db`update app.email_threads set state = 'unlinked', ended_at = now() where id = ${binding.id}`;
    await decline(binding.request_id);

    const [notice] = await notices(binding.request_id);
    expect(notice).toMatchObject({ binding_id: null, reply_to_message_id: null, state: "queued" });
    expect(await runReply(notice!.id)).toBe("completed");

    const sent = agentmail.replies.find((entry) => entry.idempotencyKey === notice!.id)!;
    expect(sent).toMatchObject({ inReplyTo: "", to: address });
    expect(sent.subject).toMatch(/closed/i);
    const started = (await bindingOf(sent.threadId))!;
    expect(started).toMatchObject({ origin: "notified", request_id: binding.request_id, state: "active" });
    expect((await notices(binding.request_id))[0]).toMatchObject({ binding_id: started.id, state: "accepted" });

    // The guest answers the notice: the declined request continues as a revised one.
    const answered = await deliver({ from: `Grace <${address}>`, inReplyTo: sent.messageId, text: "Could we try next week?", threadId: sent.threadId });
    expect(answered.outcome).toBe("forwarded");
  });

  it("is the no-reply email with the link when no inbox is configured", async () => {
    const { address, binding } = await emailRequest();
    await db`update app.email_threads set state = 'unlinked', ended_at = now() where id = ${binding.id}`;
    await db`update app.requests set state = 'declined', closed_at = now() where id = ${binding.request_id}`;
    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, binding.request_id, { kind: "status_declined" }));

    expect(await notices(binding.request_id)).toEqual([]);
    const deliveries = await db<{ kind: string; recipients: string[] }[]>`
      select kind, recipients from app.email_deliveries where request_id = ${binding.request_id} and kind = 'status_declined'
    `;
    expect(deliveries).toEqual([{ kind: "status_declined", recipients: [address] }]);
  });
});
