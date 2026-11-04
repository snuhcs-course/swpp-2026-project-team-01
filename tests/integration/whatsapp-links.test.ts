import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_TEXTS } from "../../lib/server/imessage-links";
import { CHANNEL_TEXTS } from "../../lib/server/imessage-receipts";
import { channelHash } from "../../lib/server/photon-receiver";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { newSender, newWhatsAppSender, TEST_LINE, TEST_WHATSAPP_NUMBER } from "./support/photon";
import { newHostAccount } from "./support/ready-host";
import { testTokenKey } from "./support/requests";

// Linking WhatsApp against the local stack and the stand-in
// (host-whatsapp-channel task 3.1): a WhatsApp attempt shows the WhatsApp number
// and binds only after Confirm and link; only a WhatsApp message completes it,
// and a code from the other channel voids it; confirming a sender of one channel
// ends the binding on the other and suppresses what was queued for it; an
// unlinked WhatsApp sender gets the WhatsApp refusal; WhatsApp has no contact
// card; an exact retry replays its outcome. A WhatsApp start registers the
// number first and keeps no assigned number (guest-whatsapp-link task 3.1).

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

async function pendingWhatsApp(hostAccountId: string, number = `+${newWhatsAppSender()}`) {
  const created = await im.command(hostAccountId, "imessage.link.create", { channel: "whatsapp", number });
  expect(created.ok).toBe(true);
  const status = await im.status(hostAccountId);
  if (status.state !== "pending") throw new Error(`Expected a pending code, got ${status.state}.`);
  return status;
}

describe("linking WhatsApp", () => {
  it("shows the WhatsApp number, records the WhatsApp sender, and binds only after confirmation", async () => {
    const hostAccountId = await newHostAccount(db);
    const sender = newWhatsAppSender();
    const pending = await pendingWhatsApp(hostAccountId);
    expect(pending).toMatchObject({ channel: "whatsapp", channels: { imessage: TEST_LINE, whatsapp: TEST_WHATSAPP_NUMBER }, lineNumber: TEST_WHATSAPP_NUMBER });

    expect((await im.deliver({ channel: "whatsapp", sender, text: pending.message })).outcome).toBe("link_received");
    const received = await im.status(hostAccountId);
    expect(received).toMatchObject({ channel: "whatsapp", replaces: null, sender: `+${sender}`, state: "received" });
    expect(await im.bindingOf(hostAccountId)).toBeNull();

    const [reply] = await im.outbox({ hostAccountId, kind: "link_received" });
    const { sent } = await im.send(reply!.id);
    expect(sent).toEqual([expect.objectContaining({ channel: "whatsapp", recipient: { address: sender, spaceId: sender } })]);
    expect(textOf(sent)).toEqual([LINK_TEXTS.received]);

    if (received.state !== "received") throw new Error("Expected received.");
    expect((await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId })).ok).toBe(true);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({
      channel: "whatsapp",
      sender_hash: channelHash(testTokenKey, "whatsapp", "sender", sender),
      state: "active",
    });
    expect(await im.status(hostAccountId)).toMatchObject({ channel: "whatsapp", lineNumber: TEST_WHATSAPP_NUMBER, state: "linked" });
  });

  it("voids an attempt whose code arrives from the other channel", async () => {
    const hostAccountId = await newHostAccount(db);
    const pending = await pendingWhatsApp(hostAccountId);
    const sender = newSender();
    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_refused");
    expect(await im.status(hostAccountId)).toMatchObject({ state: "none" });
    const [refusal] = await im.outbox({ kind: "link_refused", recipientHash: channelHash(testTokenKey, "imessage", "sender", sender) });
    expect(textOf((await im.send(refusal!.id)).sent)).toEqual([LINK_TEXTS.refused]);

    const imessageHost = await newHostAccount(db);
    await im.command(imessageHost, "imessage.link.create", { number: newSender() });
    const code = await im.status(imessageHost);
    if (code.state !== "pending") throw new Error("Expected pending.");
    const whatsappSender = newWhatsAppSender();
    expect((await im.deliver({ channel: "whatsapp", sender: whatsappSender, text: code.message })).outcome).toBe("link_refused");
    const [whatsappRefusal] = await im.outbox({ kind: "link_refused", recipientHash: channelHash(testTokenKey, "whatsapp", "sender", whatsappSender) });
    const { sent } = await im.send(whatsappRefusal!.id);
    expect(sent[0]?.channel).toBe("whatsapp");
    expect(textOf(sent)).toEqual([LINK_TEXTS.refusedWhatsApp]);
  });

  it("replaces an iMessage binding with WhatsApp after confirmation, and the reverse", async () => {
    const hostAccountId = await newHostAccount(db);
    const imessage = await im.link(hostAccountId);
    const queued = await db<{ id: string }[]>`
      select id from app.imessage_outbox where host_account_id = ${hostAccountId} and kind = 'linked' and state = 'queued'
    `;
    expect(queued).toHaveLength(1);

    const pending = await pendingWhatsApp(hostAccountId);
    const sender = newWhatsAppSender();
    await im.deliver({ channel: "whatsapp", sender, text: pending.message });
    const received = await im.status(hostAccountId);
    expect(received).toMatchObject({ channel: "whatsapp", replaces: "imessage", state: "received" });
    if (received.state !== "received") throw new Error("Expected received.");
    await im.command(hostAccountId, "imessage.link.confirm", { linkId: received.linkId });

    const bindings = await db<{ channel: string; state: string }[]>`
      select channel, state from app.imessage_bindings where host_account_id = ${hostAccountId} order by linked_at
    `;
    expect(bindings).toEqual([
      { channel: "imessage", state: "unlinked" },
      { channel: "whatsapp", state: "active" },
    ]);
    const [suppressed] = await db<{ state: string; failure_category: string }[]>`
      select state, failure_category from app.imessage_outbox where id = ${queued[0]!.id}
    `;
    expect(suppressed).toEqual({ failure_category: "replaced", state: "suppressed" });

    // The old iMessage sender is now unlinked.
    expect((await im.deliver({ sender: imessage.sender, text: "requests" })).outcome).toBe("unlinked_reply");

    await im.link(hostAccountId);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ channel: "imessage", state: "active" });
  });

  it("answers an unlinked WhatsApp sender with the WhatsApp refusal and no session", async () => {
    const sender = newWhatsAppSender();
    expect((await im.deliver({ channel: "whatsapp", sender, text: "what's on my calendar?" })).outcome).toBe("unlinked_reply");
    const [reply] = await im.outbox({ kind: "unlinked_sender", recipientHash: channelHash(testTokenKey, "whatsapp", "sender", sender) });
    expect(textOf((await im.send(reply!.id)).sent)).toEqual([CHANNEL_TEXTS.unlinkedWhatsApp]);
    expect((await im.deliver({ channel: "whatsapp", sender, text: "hello?" })).outcome).toBe("ignored");
  });

  it("offers no contact card on WhatsApp, and replays an exact retry", async () => {
    const hostAccountId = await newHostAccount(db);
    await im.link(hostAccountId, undefined, "whatsapp");
    const card = await im.command(hostAccountId, "imessage.contact_card.share");
    expect(card).toMatchObject({ error: { category: "invalid_input" }, ok: false });

    const other = await newHostAccount(db);
    const number = `+${newWhatsAppSender()}`;
    const first = await im.command(other, "imessage.link.create", { channel: "whatsapp", number }, "same-key");
    const again = await im.command(other, "imessage.link.create", { channel: "whatsapp", number }, "same-key");
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(first.ok && again.ok && first.result).toEqual(again.ok && again.result);
  });

  it("refuses a WhatsApp attempt where no WhatsApp number is configured", async () => {
    const hostAccountId = await newHostAccount(db);
    const { imessageCommands } = await import("../../lib/server/imessage-links");
    const { runCommand } = await import("../../lib/server/commands");
    const commands = imessageCommands({ lineNumber: TEST_LINE, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] });
    const outcome = await runCommand(
      { authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db },
      commands["imessage.link.create"]!,
      { input: { channel: "whatsapp", number: "+15557654321" }, resourceId: hostAccountId, retryKey: crypto.randomUUID() },
    );
    expect(outcome).toMatchObject({ error: { category: "unavailable_configuration" }, ok: false });
  });
});

describe("the number before a WhatsApp code", () => {
  it("registers the host's number and keeps no assigned number", async () => {
    const hostAccountId = await newHostAccount(db);
    const number = `+${newWhatsAppSender()}`;
    photon.nextRegistration({ lineNumber: "+15550009999" });
    await pendingWhatsApp(hostAccountId, number);
    expect(photon.registered.at(-1)).toBe(number);
    const [attempt] = await db<{ channel: string; line_number: string | null }[]>`
      select channel, line_number from app.imessage_links where host_account_id = ${hostAccountId} and state = 'pending'
    `;
    expect(attempt).toEqual({ channel: "whatsapp", line_number: null });
    expect(await im.status(hostAccountId)).toMatchObject({ channel: "whatsapp", lineNumber: TEST_WHATSAPP_NUMBER, state: "pending" });
  });

  it("refuses a WhatsApp code without a number, a malformed one, or a refused registration", async () => {
    const hostAccountId = await newHostAccount(db);
    const before = photon.registered.length;
    expect(await im.command(hostAccountId, "imessage.link.create", { channel: "whatsapp" })).toMatchObject({ error: { category: "invalid_input" }, ok: false });
    expect(await im.command(hostAccountId, "imessage.link.create", { channel: "whatsapp", number: "12" })).toMatchObject({
      error: { category: "invalid_input" },
      ok: false,
    });
    expect(photon.registered.length).toBe(before);
    photon.nextRegistration(422);
    expect(await im.command(hostAccountId, "imessage.link.create", { channel: "whatsapp", number: "+15557654321" })).toMatchObject({
      error: { category: "unavailable_configuration" },
      ok: false,
    });
    expect(await im.status(hostAccountId)).toMatchObject({ state: "none" });
  });
});
