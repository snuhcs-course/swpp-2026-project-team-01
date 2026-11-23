import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUESTER_IMESSAGE_OPERATIONS } from "../../lib/contracts/requester-imessage";
import { runCommand, type CommandDefinition } from "../../lib/server/commands";
import { changeEmailCommand, issueContactConfirmation } from "../../lib/server/contact-confirmation";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { addressHash, resendLinkCommand } from "../../lib/server/link-resend";
import { changeAgreementCommand } from "../../lib/server/request-proposals";
import {
  confirmRequesterImessageLinkCommand,
  createRequesterImessageLinkCommand,
  readRequesterImessageStatus,
} from "../../lib/server/requester-imessage-links";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { emailHarness } from "./support/email";
import { type FakeAgentMail, startFakeAgentMail } from "./support/fake-agentmail";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { newSender, TEST_LINE, TEST_WHATSAPP_NUMBER } from "./support/photon";
import { makeHostReady } from "./support/ready-host";
import { createTestRequest, runJob, testTokenKey, uniqueEmail } from "./support/requests";
import { asRequester, revisionOf } from "./support/scheduling";

// guest-email-and-agree-notices (issues #332 and #179) against the local stack:
// a guest whose booking link bounced changes the address and the new one gets
// the link (task 1.3); the assistant's resend goes only to a confirmed contact
// under the resend limits (task 3.3); a reply to the guest's booking
// confirmation reaches the request's discussion (task 2.4); and agreeing, or
// linking while the agreement waits, sends one chat notice of what was sent
// per version and binding (task 4.4).

const db = testDatabase();
const origin = "http://localhost:3000";
let photon: FakePhoton;
let google: FakeGoogle;
let agentmail: FakeAgentMail;
const im = imessageHarness(db, () => photon);
const email = emailHarness(db, () => agentmail);
const linkOptions = { lineNumber: TEST_LINE, registrar: im.registrar, tokenKey: testTokenKey, tokenKeys: [testTokenKey], whatsappNumber: TEST_WHATSAPP_NUMBER };
const noticeHandler = createImessageNoticeHandler(() => ({ db, origin, tokenKey: testTokenKey, tokenKeys: [testTokenKey] }));

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
  agentmail = await startFakeAgentMail();
  await email.register();
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await agentmail.close();
  await db.end();
});

function asGuest<Input, Result>(requestId: string, command: CommandDefinition<Input, Result>, input: Input, retryKey = randomUUID()) {
  return runCommand({ authenticate: async () => ({ id: requestId, kind: "requester_request" }), db }, command, {
    input,
    resourceId: requestId,
    retryKey,
  });
}

async function creationEmails(requestId: string) {
  return db<{ id: string; recipients: string[]; state: string }[]>`
    select id, recipients, state from app.email_deliveries where request_id = ${requestId} and kind = 'request_creation' order by created_at
  `;
}

async function bounce(deliveryId: string) {
  await db`
    update app.email_deliveries set state = 'rejected', completed_at = now(), secret_ciphertext = null, secret_key_id = null,
           created_at = created_at - interval '2 minutes'
    where id = ${deliveryId}
  `;
}

describe("changing the address after a bounce (#332)", () => {
  it("is refused while the booking link was delivered", async () => {
    const request = await createTestRequest(db);
    await db.begin((tx) => issueContactConfirmation(tx, { bookingId: request.bookingId, origin, requestId: request.requestId, tokenKey: testTokenKey }));

    const changed = await asGuest(request.requestId, changeEmailCommand({ origin, tokenKey: testTokenKey }), { email: uniqueEmail("other") });
    expect(changed).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    const [row] = await db<{ contact_email: string }[]>`select contact_email from app.requests where id = ${request.requestId}`;
    expect(row!.contact_email).toBe(request.contactEmail);
  });

  it("replaces a bounced address and sends the creation email to the new one", async () => {
    const request = await createTestRequest(db);
    const issued = await db.begin((tx) =>
      issueContactConfirmation(tx, { bookingId: request.bookingId, origin, requestId: request.requestId, tokenKey: testTokenKey }),
    );
    await bounce(issued.deliveryId);
    const [{ revision: before }] = await db<{ revision: number }[]>`select revision from app.requests where id = ${request.requestId}`;

    const next = uniqueEmail("fixed");
    const changed = await asGuest(request.requestId, changeEmailCommand({ origin, tokenKey: testTokenKey }), { email: next });
    expect(changed).toMatchObject({ ok: true, result: { status: "queued" } });

    const [row] = await db<{ contact_email: string; contact_confirmed_email: string | null; revision: number }[]>`
      select contact_email, contact_confirmed_email, revision from app.requests where id = ${request.requestId}
    `;
    expect(row).toEqual({ contact_confirmed_email: null, contact_email: next, revision: before });
    expect((await creationEmails(request.requestId)).map((delivery) => delivery.recipients[0])).toEqual([request.contactEmail, next]);
    // The bounced address's confirmation link is void.
    const live = await db`select 1 from app.contact_confirmations where request_id = ${request.requestId} and superseded_at is null and contact_email = ${request.contactEmail}`;
    expect(live).toHaveLength(0);
  });

  it("is limited like every creation email", async () => {
    const request = await createTestRequest(db);
    const issued = await db.begin((tx) =>
      issueContactConfirmation(tx, { bookingId: request.bookingId, origin, requestId: request.requestId, tokenKey: testTokenKey }),
    );
    await db`update app.email_deliveries set state = 'rejected', completed_at = now(), secret_ciphertext = null, secret_key_id = null where id = ${issued.deliveryId}`;

    const changed = await asGuest(request.requestId, changeEmailCommand({ origin, tokenKey: testTokenKey }), { email: uniqueEmail("soon") });
    expect(changed).toMatchObject({ ok: true, result: { status: "limited" } });
    expect(await creationEmails(request.requestId)).toHaveLength(1);
  });
});

describe("resending the booking link from the conversation (#332)", () => {
  it("sends nothing to an unconfirmed contact", async () => {
    const request = await createTestRequest(db);
    const resent = await asGuest(request.requestId, resendLinkCommand({ origin, tokenKey: testTokenKey }), {});
    expect(resent).toMatchObject({ ok: true, result: { status: "unconfirmed" } });
    expect(await db`select 1 from app.email_deliveries where request_id = ${request.requestId} and kind = 'link_resend'`).toHaveLength(0);
  });

  it("sends the link to the confirmed contact once per call, under the per-request limit", async () => {
    const request = await createTestRequest(db, { confirmed: true });
    const command = resendLinkCommand({ origin, tokenKey: testTokenKey });
    const retryKey = randomUUID();

    const first = await asGuest(request.requestId, command, {}, retryKey);
    expect(first).toMatchObject({ ok: true, result: { status: "queued" } });
    // A retried tool call replays its result without another email.
    expect(await asGuest(request.requestId, command, {}, retryKey)).toMatchObject({ ok: true, replayed: true });
    // A second call within the minute is limited.
    expect(await asGuest(request.requestId, command, {})).toMatchObject({ ok: true, result: { status: "limited" } });

    const deliveries = await db<{ recipients: string[] }[]>`
      select recipients from app.email_deliveries where request_id = ${request.requestId} and kind = 'link_resend'
    `;
    expect(deliveries).toEqual([{ recipients: [request.contactEmail] }]);
    const issuances = await db`
      select 1 from app.link_resend_issuances where request_id = ${request.requestId} and recipient_hash = ${addressHash(testTokenKey, request.contactEmail)}
    `;
    expect(issuances).toHaveLength(1);
  });

  it("reaches the confirmed contact of a booked meeting", async () => {
    const request = await createTestRequest(db, { confirmed: true });
    await db`update app.requests set state = 'booked', closed_at = now() where id = ${request.requestId}`;
    const resent = await asGuest(request.requestId, resendLinkCommand({ origin, tokenKey: testTokenKey }), {});
    expect(resent).toMatchObject({ ok: true, result: { status: "queued" } });
  });
});

describe("replies to the guest's booking confirmation (#332)", () => {
  async function confirmationSent(requestId: string, recipient: string, replyTo: string) {
    const providerId = `<cf-${randomUUID()}@cloudflare.test>`;
    await db`
      insert into app.email_deliveries (kind, request_id, dedupe_key, sender, recipients, template, language, parameters, reply_to, state, completed_at, provider_message_id)
      values ('booking_confirmation', ${requestId}, ${`${randomUUID()}:requester`}, 'Ada <no-reply@findmeatime.com>', ${[recipient]}, 'booking_confirmation', 'en',
              ${db.json({ audience: "requester" })}, ${replyTo}, 'accepted', now(), ${providerId})
    `;
    return providerId;
  }

  it("forwards a reply from the confirmed recipient into the request's discussion in a new bound thread", async () => {
    const request = await createTestRequest(db);
    await makeHostReady(db, request.hostAccountId);
    await db`update app.requests set state = 'booked', closed_at = now() where id = ${request.requestId}`;
    const providerId = await confirmationSent(request.requestId, request.contactEmail, email.inbox);

    const delivered = await email.deliver({ from: `Grace <${request.contactEmail}>`, inReplyTo: providerId, subject: "Re: Your meeting is booked", text: "Is there parking nearby?" });
    expect(delivered.outcome).toBe("forwarded");

    const binding = await email.bindingOf(delivered.message.thread_id);
    expect(binding).toMatchObject({ origin: "started", request_id: request.requestId });
    const inputs = await email.inputsOf(request.requestId);
    expect(inputs.at(-1)!.message).toBe("[Email] Subject: Re: Your meeting is booked\n\nIs there parking nearby?");
  });

  it("ignores a reply from another address, and a confirmation that did not reply to the inbox", async () => {
    const request = await createTestRequest(db);
    await makeHostReady(db, request.hostAccountId);
    const providerId = await confirmationSent(request.requestId, request.contactEmail, email.inbox);
    const stranger = await email.deliver({ from: `Someone <${uniqueEmail("stranger")}>`, inReplyTo: providerId, text: "Hello" });
    expect(stranger.outcome).toBe("ignored");

    const other = await createTestRequest(db);
    const otherId = await confirmationSent(other.requestId, other.contactEmail, "host@example.test");
    const direct = await email.deliver({ from: `Grace <${other.contactEmail}>`, inReplyTo: otherId, text: "Hello" });
    expect(direct.outcome).toBe("ignored");
    expect(await email.bindingOf(direct.message.thread_id)).toBeNull();
  });
});

async function linkGuest(requestId: string) {
  const create = createRequesterImessageLinkCommand(linkOptions);
  const confirm = confirmRequesterImessageLinkCommand(linkOptions);
  expect((await asGuest(requestId, create as CommandDefinition<unknown, unknown>, { number: "+15557654321" })).ok).toBe(true);
  const pending = await readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE, TEST_WHATSAPP_NUMBER);
  if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
  await im.deliver({ sender: newSender(), text: pending.message });
  const received = await readRequesterImessageStatus(db, [testTokenKey], requestId, TEST_LINE, TEST_WHATSAPP_NUMBER);
  if (received.state !== "received") throw new Error(`Expected a received code, got ${received.state}.`);
  expect((await asGuest(requestId, confirm as CommandDefinition<unknown, unknown>, { linkId: received.linkId })).ok).toBe(true);
}

async function agreementNotices(requestId: string) {
  const jobs = await db<{ id: string }[]>`
    select id from app.jobs where kind = ${IMESSAGE_NOTICE_JOB} and state = 'pending' and payload ->> 'requestId' = ${requestId}
      and payload -> 'notice' ->> 'kind' = 'agreement_sent'
    order by created_at
  `;
  for (const job of jobs) await runJob(db, job.id, noticeHandler);
  return db<{ text: string | null; dedupe_key: string }[]>`
    select text, dedupe_key from app.imessage_outbox where request_id = ${requestId} and kind = 'notice' and dedupe_key like 'guest-notice:agreement_sent:%'
    order by created_at
  `;
}

describe("the agreement notice in the guest's linked chat (#179)", () => {
  it("sends what the guest agreed to, once, without the booking link", async () => {
    const request = await agreedRequest(db, google, { beforeAgree: (seeded) => linkGuest(seeded.requestId) });
    const sent = await agreementNotices(request.requestId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/^You sent this to .+:\n- People: /);
    expect(sent[0]!.text).toContain("is not booked yet");
    expect(sent[0]!.text).not.toContain("/booking/");
    // The job again sends nothing more.
    expect(await agreementNotices(request.requestId)).toHaveLength(1);
  });

  it("reaches a guest who links after agreeing", async () => {
    const request = await agreedRequest(db, google);
    expect(await agreementNotices(request.requestId)).toHaveLength(0);
    await linkGuest(request.requestId);
    expect(await agreementNotices(request.requestId)).toHaveLength(1);
  });

  it("sends nothing for a version the guest reopened before the job ran", async () => {
    const request = await agreedRequest(db, google, { beforeAgree: (seeded) => linkGuest(seeded.requestId) });
    const changed = await asRequester(db, request.requestId, changeAgreementCommand, {}, { expectedRevision: await revisionOf(db, request.requestId) });
    expect(changed.ok).toBe(true);
    expect(await agreementNotices(request.requestId)).toHaveLength(0);
  });
});
