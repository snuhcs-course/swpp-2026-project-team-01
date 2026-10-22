import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueStatusNotice } from "../../lib/server/booking-notices";
import { testDatabase } from "./support/database";
import { emailHarness } from "./support/email";
import { type FakeAgentMail, startFakeAgentMail } from "./support/fake-agentmail";
import { readyHost } from "./support/guests";
import { testNotices, uniqueEmail } from "./support/requests";

// Thread notices (requester-email-channel design 7; task 4.3): a request with a
// bound thread gets each status notice in that thread as well as by email, from
// the same template with the booking link sealed until dispatch, replying to
// the thread's latest message; a notice whose thread was unlinked, or whose
// condition no longer holds, is suppressed, and the email is unaffected.

const db = testDatabase();
let agentmail: FakeAgentMail;
const email = emailHarness(db, () => agentmail);
const { bindingOf, deliver, runReply } = email;

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
  await db.begin((tx) => enqueueStatusNotice(tx, testNotices, requestId, { kind: "status_declined" }));
}

async function notices(requestId: string) {
  return db<{ id: string; state: string; text: string | null; secret_ciphertext: string | null; reply_to_message_id: string }[]>`
    select id, state, text, secret_ciphertext, reply_to_message_id from app.email_replies where request_id = ${requestId} and kind = 'notice'
  `;
}

describe("thread notices", () => {
  it("sends the decline notice in the thread and by email", async () => {
    const { address, binding, message } = await emailRequest();
    await decline(binding.request_id);

    const [notice] = await notices(binding.request_id);
    expect(notice).toMatchObject({ reply_to_message_id: message.message_id, state: "queued", text: null });
    expect(notice!.secret_ciphertext).not.toBeNull();
    const deliveries = await db<{ kind: string; recipients: string[] }[]>`
      select kind, recipients from app.email_deliveries where request_id = ${binding.request_id} and kind = 'status_declined'
    `;
    expect(deliveries).toEqual([{ kind: "status_declined", recipients: [address] }]);

    expect(await runReply(notice!.id)).toBe("completed");
    const [sent] = agentmail.repliesIn(message.thread_id);
    expect(sent!.inReplyTo).toBe(message.message_id);
    expect(sent!.text).toMatch(/declined/i);
    expect(sent!.text).toMatch(/http:\/\/localhost:3000\/booking\/[0-9a-f-]{36}/);

    const [after] = await notices(binding.request_id);
    expect(after).toMatchObject({ secret_ciphertext: null, state: "accepted", text: null });

    // Recording the same notice again makes no second reply.
    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, binding.request_id, { kind: "status_declined" }));
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

  it("records no thread copy for a request without a thread", async () => {
    const { binding } = await emailRequest();
    await db`update app.email_threads set state = 'unlinked', ended_at = now() where id = ${binding.id}`;
    await decline(binding.request_id);
    expect(await notices(binding.request_id)).toEqual([]);
  });
});
