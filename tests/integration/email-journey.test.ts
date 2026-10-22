import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailLinkStatus } from "../../lib/contracts/email-link";
import { EMAIL_RECEIPT_JOB } from "../../lib/server/agentmail-receiver";
import { enqueueStatusNotice } from "../../lib/server/booking-notices";
import { runCommand } from "../../lib/server/commands";
import { eveRuntime } from "../../lib/server/conversations";
import { createEmailLinkCommand } from "../../lib/server/email-links";
import { createEmailReceiptHandler } from "../../lib/server/email-receipts";
import { EMAIL_REPLY_JOB } from "../../lib/server/email-replies";
import { acceptGuestMessage } from "../../lib/server/guest-conversations";
import { createEmailLinkStatusHandler } from "../../lib/server/requester-routes";
import { clearServiceWindow, testDatabase } from "./support/database";
import { emailHarness } from "./support/email";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeAgentMail, receivedMessage, startFakeAgentMail, webhookRequest } from "./support/fake-agentmail";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";
import { call, guestDependencies, readyHost } from "./support/guests";
import { createTestRequest, runJob, testNotices, testTokenKey, uniqueEmail } from "./support/requests";

// The Phase 7 join (task 5.1) against a real `eve dev` whose model is the local
// OpenAI stand-in, the local stack and a fake AgentMail. A requester starts by
// email: AgentMail's signed webhook reaches the agent service's agentmail
// channel, the receipt job starts an identified request and forwards the first
// message into its one requester discussion, the turn runs in eve, the
// session-owner hook makes the reply due, and the reply job answers in the same
// thread with the turn's text. After confirming the address the requester
// continues at the booking link in the same session (AC-11); an email choosing
// an old option records nothing and creates no second request (AC-05); the
// host's decline reaches the thread. A web requester links a thread with
// Continue by email and continues there (AC-11, the other way).

const db = testDatabase();
let agentmail: FakeAgentMail;
let fake: FakeOpenAI;
let server: EveServer;
const email = emailHarness(db, () => agentmail);
let receiverId: string;

beforeAll(async () => {
  agentmail = await startFakeAgentMail();
  fake = await startFakeOpenAI();
  await clearServiceWindow(db);
  receiverId = await email.register();
  // The agent service's receiver reads these.
  process.env.AGENTMAIL_INBOX_ID = email.inbox;
  process.env.AGENTMAIL_WEBHOOK_SECRET = email.secret;
  server = await startEve("dev", { modelBaseURL: fake.baseURL });
}, 300_000);

afterAll(async () => {
  await server?.stop();
  await fake?.close();
  await agentmail?.close();
  await db.end();
});

const conversation = () => ({
  admission: { serviceKey: `test:${randomUUID()}` },
  db,
  runtime: eveRuntime(server.url),
  signingKey: server.signingKey,
});

async function waitFor(check: () => Promise<boolean>, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

// AgentMail delivers to the agent service's channel route; the job then runs.
async function arrive(message: ReturnType<typeof receivedMessage>) {
  agentmail.addMessage(message);
  const response = await fetch(webhookRequest(`${server.url}/agentmail/webhooks/${receiverId}`, email.secret, message));
  expect(response.status).toBe(204);
  const [receipt] = await db<{ id: string }[]>`select id from app.email_receipts where inbox_id = ${email.inbox} and message_id = ${message.message_id}`;
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${EMAIL_RECEIPT_JOB} and dedupe_key = ${`receipt:${receipt!.id}`}`;
  await runJob(db, job!.id, createEmailReceiptHandler(() => email.receiptDeps({ conversation: conversation() })));
  const [after] = await db<{ outcome: string }[]>`select outcome from app.email_receipts where id = ${receipt!.id}`;
  return after!.outcome;
}

// Waits for the turn of each forwarded message to end, then sends its reply.
async function answer(threadId: string) {
  const waiting = await db<{ id: string; input_id: string }[]>`
    select e.id, e.input_id from app.email_replies e
    where e.inbox_id = ${email.inbox} and e.kind = 'turn' and e.state = 'waiting'
      and e.reply_to_message_id in (select message_id from app.email_receipts where thread_id = ${threadId})
  `;

  for (const reply of waiting) {
    expect(
      await waitFor(async () => {
        const [input] = await db<{ state: string }[]>`select state from app.conversation_inputs where id = ${reply.input_id}`;
        return input!.state === "completed";
      }),
    ).toBe(true);

    // The session-owner hook made the waiting reply due when the turn ended.
    expect(
      await waitFor(async () => {
        const [job] = await db<{ due: boolean }[]>`
          select run_after <= now() as due from app.jobs where kind = ${EMAIL_REPLY_JOB} and dedupe_key = ${`reply:${reply.id}`}
        `;
        return job!.due;
      }, 40),
    ).toBe(true);

    expect(await email.runReply(reply.id, email.replyDeps({ runtime: eveRuntime(server.url), signingKey: server.signingKey }))).toBe("completed");
  }
}

describe("a requester who starts by email", () => {
  it("is answered in the thread, continues at the booking link in the same session, and hears the decline", async () => {
    const host = await readyHost(db, { displayName: "Ada Lovelace" });
    const address = uniqueEmail("journey");
    fake.rules.push({ includes: "Can we find 30 minutes", reply: { kind: "text", text: "Happy to set that up. Which week suits you?" } });

    const first = receivedMessage(email.inbox, { from: `Grace Hopper <${address}>`, subject: `Meeting with @${host.handle}`, text: "Can we find 30 minutes next week?" });
    expect(await arrive(first)).toBe("started");
    const binding = (await email.bindingOf(first.thread_id))!;
    await answer(first.thread_id);

    const [reply] = agentmail.repliesIn(first.thread_id);
    expect(reply!.inReplyTo).toBe(first.message_id);
    expect(reply!.text).toMatch(/^Happy to set that up\. Which week suits you\?\n\n--\n/);

    // The creation email went to the address; confirming it (as the email's
    // link does) lets the requester continue at the booking link.
    const [creation] = await db<{ recipients: string[] }[]>`select recipients from app.email_deliveries where request_id = ${binding.request_id} and kind = 'request_creation'`;
    expect(creation!.recipients).toEqual([address]);
    await db`update app.requests set contact_confirmed_email = contact_email where id = ${binding.request_id}`;

    fake.rules.push({ includes: "From the booking page", reply: { kind: "text", text: "Got it." } });
    await acceptGuestMessage(conversation(), { id: binding.request_id, type: "requester_request" }, { clientInputId: randomUUID(), message: "From the booking page: Tuesday works." });
    const sessions = await db<{ session_id: string; inputs: number }[]>`
      select s.session_id, (select count(*)::int from app.conversation_inputs i where i.session_id = s.session_id) as inputs
      from app.agent_sessions s join app.discussions d on d.id = s.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${binding.request_id}
    `;
    // One session holds the email message and the web message (AC-11).
    expect(sessions).toHaveLength(1);
    expect(await waitFor(async () => {
      const [row] = await db<{ inputs: number }[]>`select count(*)::int as inputs from app.conversation_inputs where session_id = ${sessions[0]!.session_id} and state = 'completed'`;
      return row!.inputs === 2;
    })).toBe(true);

    // An email choosing an old option is conversation only (AC-05).
    fake.rules.push({ includes: "option 2", reply: { kind: "text", text: "Please choose on your booking page." } });
    const old = receivedMessage(email.inbox, { from: `Grace Hopper <${address}>`, inReplyTo: first.message_id, text: "I'll take option 2 from your first message.", threadId: first.thread_id });
    expect(await arrive(old)).toBe("forwarded");
    await answer(first.thread_id);
    const [effects] = await db<{ agreements: number; requests: number }[]>`
      select (select count(*)::int from app.agreements a join app.proposals p on p.id = a.proposal_id where p.request_id = ${binding.request_id}) as agreements,
             (select count(*)::int from app.requests where lower(contact_email) = ${address}) as requests
    `;
    expect(effects).toEqual({ agreements: 0, requests: 1 });
    expect(agentmail.repliesIn(first.thread_id)).toHaveLength(2);

    // The host declines: the notice reaches the thread.
    await db`update app.requests set state = 'declined', closed_at = now() where id = ${binding.request_id}`;
    await db.begin((tx) => enqueueStatusNotice(tx, testNotices, binding.request_id, { kind: "status_declined" }));
    const [notice] = await db<{ id: string }[]>`select id from app.email_replies where request_id = ${binding.request_id} and kind = 'notice'`;
    expect(await email.runReply(notice!.id)).toBe("completed");
    expect(agentmail.repliesIn(first.thread_id)[2]!.text).toMatch(/declined/i);
  });
});

describe("a requester who started on the web", () => {
  it("links a thread and continues the same conversation by email", async () => {
    const host = await readyHost(db);
    const request = await createTestRequest(db, { confirmed: true, contactEmail: uniqueEmail("web"), hostAccountId: host.hostAccountId });
    await db`insert into app.discussions (principal_type, principal_id, audience) values ('requester_request', ${request.requestId}, 'requester')`;

    const created = await runCommand(
      { authenticate: async () => ({ id: request.requestId, kind: "requester_request" }), db },
      createEmailLinkCommand({ tokenKey: testTokenKey }),
      { input: {}, resourceId: request.requestId, retryKey: randomUUID() },
    );
    expect(created.ok).toBe(true);
    const status = (await (
      await call(createEmailLinkStatusHandler(() => guestDependencies(db, { emailInbox: email.inbox })), { bookingId: request.bookingId }, "/x")
    ).json()) as EmailLinkStatus;
    if (status.state !== "pending") throw new Error(status.state);

    const linking = receivedMessage(email.inbox, { from: `Grace <${request.contactEmail}>`, subject: status.code, text: status.code });
    expect(await arrive(linking)).toBe("linked");
    const [confirmation] = await db<{ id: string }[]>`select id from app.email_replies where request_id = ${request.requestId} and kind = 'link_confirmation'`;
    expect(await email.runReply(confirmation!.id)).toBe("completed");

    fake.rules.push({ includes: "Thursday afternoon", reply: { kind: "text", text: "Thursday afternoon noted." } });
    const next = receivedMessage(email.inbox, { from: `Grace <${request.contactEmail}>`, inReplyTo: linking.message_id, text: "Thursday afternoon is best.", threadId: linking.thread_id });
    expect(await arrive(next)).toBe("forwarded");
    await answer(linking.thread_id);

    const texts = agentmail.repliesIn(linking.thread_id).map((entry) => entry.text);
    expect(texts[0]).toMatch(/^This thread is now linked/);
    // The linking message never reached the model; the next one did.
    expect(fake.requests.some((entry) => JSON.stringify(entry.input ?? "").includes(status.code))).toBe(false);
    expect(texts[1]).toMatch(/^Thursday afternoon noted\./);
  });
});
