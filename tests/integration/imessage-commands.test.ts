import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveCommand } from "../../lib/server/bookings";
import { requestRef, reviewRef, settingsRef } from "../../lib/server/imessage-commands";
import { receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { computeSetupProposal } from "../../lib/server/setup";
import { suggestChangesCommand } from "../../lib/server/shared-changes";
import { agreedRequest, asHost } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { messagesEvent, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "./support/photon";
import { testTokenKey } from "./support/requests";
import { prepareReviewableHost, seedHost, setupDependencies } from "./support/setup-host";

// Exact iMessage commands against the local stack, the fake Google and the
// Photon stand-in (host-imessage-channel task 4.2): each command's reply; a
// stale or unknown reference changes nothing and names the current one; "yes"
// decides nothing; approval and decline run as the linked host and a replayed
// approval, also after a web approval, makes one booking; suggested changes are
// shared or dismissed by reference; and settings are saved only by the current
// review's reference.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
let setupDeps: ReturnType<typeof setupDependencies>;
const im = imessageHarness(db, () => photon, { receipt: () => ({ setup: setupDeps }) });

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

// Sends a message from the host's linked sender and returns the reply text sent.
async function say(sender: string, hostAccountId: string, text: string, id?: string) {
  const delivered = await im.deliver({ id, sender, text });
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'command' and dedupe_key = ${`receipt:${delivered.receiptId}`}
  `;
  if (rows.length === 0) return { delivered, reply: null };
  const { sent } = await im.send(rows[0]!.id);
  return { delivered, reply: textOf(sent)[0] ?? null };
}

const receiver = () => ({ config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID }, db, tokenKey: testTokenKey });

async function approvalsOf(requestId: string) {
  return db<{ id: string }[]>`select id from app.approvals where request_id = ${requestId}`;
}

describe("request commands", () => {
  it("lists, selects and reviews a request with its exact decision commands", async () => {
    const request = await agreedRequest(db, google);
    const { sender } = await im.link(request.hostAccountId);
    const ref = requestRef(request.requestId);

    expect((await say(sender, request.hostAccountId, "help")).reply).toContain("approve <ref> or decline <ref>");
    expect((await say(sender, request.hostAccountId, "requests")).reply).toContain(`${ref}: Grace Hopper, awaiting your approval`);

    const selected = await say(sender, request.hostAccountId, `request ${ref.toLowerCase()}`);
    expect(selected.delivered.outcome).toBe("command");
    expect(selected.reply).toContain(`approve ${reviewRef(request.requestId, 1)}`);
    expect((await im.bindingOf(request.hostAccountId))?.selected_request_id).toBe(request.requestId);

    const review = await say(sender, request.hostAccountId, "Review");
    expect(review.reply).toContain(`Request ${ref} from Grace Hopper`);
    expect(review.reply).toContain(`decline ${reviewRef(request.requestId, 1)}`);
  });

  it("changes nothing for an outdated or unknown reference, or a plain yes", async () => {
    const request = await agreedRequest(db, google);
    const { sender } = await im.link(request.hostAccountId);
    const ref = requestRef(request.requestId);

    expect((await say(sender, request.hostAccountId, `approve ${ref}-7`)).reply).toContain(`The current one is ${ref}-1`);
    expect((await say(sender, request.hostAccountId, "approve ZZZZZZ-1")).reply).toContain("I don't recognize that reference");
    expect((await say(sender, request.hostAccountId, "yes")).delivered.outcome).not.toBe("command");
    expect(await approvalsOf(request.requestId)).toHaveLength(0);
  });

  it("approves the current proposal once, also when replayed and after a web approval", async () => {
    const request = await agreedRequest(db, google);
    const { sender } = await im.link(request.hostAccountId);
    const decision = reviewRef(request.requestId, 1);
    const messageId = `msg_${randomUUID()}`;

    const approved = await say(sender, request.hostAccountId, `approve ${decision}`, messageId);
    expect(approved.reply).toBe("Approved. I'm adding it to your calendar and will tell you when it's confirmed.");
    expect(await approvalsOf(request.requestId)).toHaveLength(1);

    // The same message delivered again is one receipt.
    const again = await receivePhotonWebhook(signedWebhook(messagesEvent({ id: messageId, sender, text: `approve ${decision}` })), receiver);
    expect(again.status).toBe(200);
    expect(await db`select 1 from app.imessage_receipts where message_id = ${messageId}`).toHaveLength(1);

    // A restart after the approval committed but before the receipt's job did:
    // the job's transaction rolled back, so the receipt is unprocessed again and
    // its retry replays the saved approval.
    const replayId = await im.store({ sender, text: `approve ${decision}` });
    await im.processTwice(replayId);
    expect(await approvalsOf(request.requestId)).toHaveLength(1);
    expect(await db`select 1 from app.bookings where request_id = ${request.requestId}`).toHaveLength(1);
    expect(await db`select 1 from app.imessage_outbox where dedupe_key = ${`receipt:${replayId}`}`).toHaveLength(1);

    // A web approval meanwhile, then another iMessage approval: still one booking.
    const web = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 });
    expect(web).toMatchObject({ ok: true, result: { repeated: true } });
    expect((await say(sender, request.hostAccountId, `approve ${decision}`)).reply).toBe("That proposal is already approved; the booking is under way.");
    expect(await db`select 1 from app.bookings where request_id = ${request.requestId}`).toHaveLength(1);
  });

  it("declines by reference and creates no event", async () => {
    const request = await agreedRequest(db, google);
    const { sender } = await im.link(request.hostAccountId);
    const declined = await say(sender, request.hostAccountId, `decline ${reviewRef(request.requestId, 1)}`);
    expect(declined.reply).toBe("Declined. The requester will be told; nothing was booked.");
    expect((await db<{ state: string }[]>`select state from app.requests where id = ${request.requestId}`)[0]!.state).toBe("declined");
    expect(await db`select 1 from app.bookings where request_id = ${request.requestId}`).toHaveLength(0);
  });

  it("shows, shares and dismisses suggested changes by reference", async () => {
    const request = await agreedRequest(db, google);
    const { sender } = await im.link(request.hostAccountId);
    const ref = requestRef(request.requestId);
    expect((await say(sender, request.hostAccountId, "changes")).reply).toBe("Choose a request first: send requests, then request <ref>.");
    await say(sender, request.hostAccountId, `request ${ref}`);
    expect((await say(sender, request.hostAccountId, "changes")).reply).toContain("There are no suggested changes");

    const later = new Date(new Date(request.start).getTime() + 60 * 60_000).toISOString();
    await asHost(db, request.hostAccountId, request.requestId, suggestChangesCommand("assistant"), { changes: { start: later } });
    const shown = await say(sender, request.hostAccountId, "changes");
    expect(shown.reply).toContain(`share ${ref}-S1`);
    expect((await say(sender, request.hostAccountId, `dismiss ${ref}-S2`)).reply).toContain(`The current ones are ${ref}-S1`);

    const shared = await say(sender, request.hostAccountId, `share ${ref}-S1`);
    expect(shared.reply).toContain("Shared.");
    expect((await db<{ state: string }[]>`select state from app.shared_change_drafts where request_id = ${request.requestId}`)[0]!.state).not.toBe("pending");
  });
});

describe("settings commands", () => {
  it("reviews settings with their reference and saves them only for the current one", async () => {
    const host = await seedHost(db, setupDeps, google);
    await prepareReviewableHost(db, host);
    const { sender } = await im.link(host.hostAccountId);

    expect((await say(sender, host.hostAccountId, "setup")).reply).toContain("Setup selected.");
    const proposal = await computeSetupProposal(db, host.hostAccountId);
    const ref = settingsRef(proposal!.proposalHash);
    const review = await say(sender, host.hostAccountId, "review");
    expect(review.reply).toContain("Your settings for review:");
    expect(review.reply).toContain(`confirm ${ref}`);

    expect((await say(sender, host.hostAccountId, "confirm 00000000")).reply).toContain(`The current one is ${ref}`);
    expect(await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`).toHaveLength(0);

    const saved = await say(sender, host.hostAccountId, `confirm ${ref}`);
    expect(saved.reply).toMatch(/^Saved\. Your booking link is https:\/\/findmeatime\.test\//);
    expect(await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`).toHaveLength(1);
  });
});
