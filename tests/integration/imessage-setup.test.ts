import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settingsRef } from "../../lib/server/imessage-commands";
import { computeSetupProposal } from "../../lib/server/setup";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { draftRevision, hostCommandDeps, prepareReviewableHost, seedHost, setupDependencies } from "./support/setup-host";
import { runCommand } from "../../lib/server/commands";
import { updateDraftCommand } from "../../lib/server/setup-commands";

// Setup over iMessage and the channel's retention (host-imessage-channel task
// 4.5): after `setup`, plain text reaches the same setup discussion /app uses;
// review lists what is still needed before it offers a confirm command; a review
// reference goes stale when the draft changes; and the cleanup deletes receipts,
// outbound messages and ended attempts and bindings past their period.

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

async function reply(hostAccountId: string, receiptId: string) {
  const [row] = await db<{ id: string }[]>`
    select id from app.imessage_outbox where host_account_id = ${hostAccountId} and dedupe_key = ${`receipt:${receiptId}`}
  `;
  return textOf((await im.send(row!.id)).sent)[0] ?? "";
}

describe("setup over iMessage", () => {
  it("shares the setup discussion with /app and names what is still needed", async () => {
    const host = await seedHost(db, setupDeps, google);
    const { sender } = await im.link(host.hostAccountId);

    const entered = await im.deliver({ sender, text: "setup" });
    expect(await reply(host.hostAccountId, entered.receiptId)).toContain("Setup selected.");

    await im.deliver({ sender, text: "Thirty-minute meetings, please" });
    const [input] = await im.inputsOf(host.hostAccountId);
    const [setupDiscussion] = await db<{ id: string }[]>`
      select id from app.discussions where principal_type = 'host_account' and principal_id = ${host.hostAccountId} and audience = 'host_setup'
    `;
    expect(input).toMatchObject({ message: "[iMessage] Thirty-minute meetings, please", request_id: null });
    expect(setupDiscussion!.id).toBe(host.discussionId);

    const review = await im.deliver({ sender, text: "review" });
    const text = await reply(host.hostAccountId, review.receiptId);
    expect(text).toContain("Still needed:");
    expect(text).not.toContain("confirm ");
  });

  it("makes a review reference stale when the draft changes", async () => {
    const host = await seedHost(db, setupDeps, google);
    await prepareReviewableHost(db, host);
    const { sender } = await im.link(host.hostAccountId);
    const before = settingsRef((await computeSetupProposal(db, host.hostAccountId))!.proposalHash);

    const changed = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
      expectedRevision: await draftRevision(db, host.hostAccountId),
      input: { action: "adjust", field: "durationMinutes", value: 45 },
      resourceId: host.hostAccountId,
      retryKey: crypto.randomUUID(),
    });
    expect(changed.ok).toBe(true);
    const after = settingsRef((await computeSetupProposal(db, host.hostAccountId))!.proposalHash);
    expect(after).not.toBe(before);

    const stale = await im.deliver({ sender, text: `confirm ${before}` });
    expect(await reply(host.hostAccountId, stale.receiptId)).toContain(`The current one is ${after}`);
    expect(await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`).toHaveLength(0);
  });
});

describe("retention", () => {
  it("deletes receipts and outbound messages past 30 days and keeps active bindings", async () => {
    const host = await seedHost(db, setupDeps, google);
    const { sender } = await im.link(host.hostAccountId);
    const delivered = await im.deliver({ sender, text: "help" });
    await db`update app.imessage_receipts set received_at = now() - interval '31 days' where id = ${delivered.receiptId}`;
    await db`update app.imessage_outbox set created_at = now() - interval '31 days' where host_account_id = ${host.hostAccountId}`;

    expect(await db`select text_ciphertext from app.imessage_receipts where id = ${delivered.receiptId} and text_ciphertext is null`).toHaveLength(1);
    await db`select app.cleanup_imessage_records(100000)`;

    expect(await db`select 1 from app.imessage_receipts where id = ${delivered.receiptId}`).toHaveLength(0);
    expect(await db`select 1 from app.imessage_outbox where host_account_id = ${host.hostAccountId}`).toHaveLength(0);
    expect(await im.bindingOf(host.hostAccountId)).toMatchObject({ state: "active" });
  });
});
