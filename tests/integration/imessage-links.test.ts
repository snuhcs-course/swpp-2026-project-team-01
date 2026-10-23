import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkMessage } from "../../lib/contracts/imessage";
import { generateLinkCode } from "../../lib/server/email-links";
import { calendarConnectUrl, LINK_TEXTS, lockActiveBindingOfSender } from "../../lib/server/imessage-links";
import { imessageHash } from "../../lib/server/photon-receiver";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness, textOf } from "./support/imessage";
import { newSender } from "./support/photon";
import { makeHostReady, newHostAccount } from "./support/ready-host";
import { testTokenKey } from "./support/requests";

// Linking a host's iMessage against the local stack and the Photon stand-in
// (host-imessage-channel task 3.1): a code binds only after the host confirms
// the masked sender; wrong, expired, replayed, group and foreign-sender codes
// bind nothing and void the attempt; a sender belongs to one host; the
// fallback's limits and wrong entries hold and the browser never sees its code;
// unlinking needs no Photon; and an exact retry replays its outcome.

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

async function pendingCode(hostAccountId: string) {
  const created = await im.command(hostAccountId, "imessage.link.create");
  expect(created.ok).toBe(true);
  const status = await im.status(hostAccountId);
  if (status.state !== "pending") throw new Error(`Expected a pending code, got ${status.state}.`);
  return status;
}

async function linkedHost(existing?: string) {
  const hostAccountId = existing ?? (await newHostAccount(db));
  const sender = newSender();
  const { code } = await pendingCode(hostAccountId);
  const message = linkMessage(code);
  await im.deliver({ sender, text: message });
  const status = await im.status(hostAccountId);
  if (status.state !== "received") throw new Error("Expected a received code.");
  const linkId = status.linkId;
  const confirmed = await im.command(hostAccountId, "imessage.link.confirm", { linkId });
  expect(confirmed.ok).toBe(true);
  return { hostAccountId, linkId, message, sender };
}

describe("linking by a host-sent code", () => {
  it("shows the code and the exact message, records the arriving sender, and binds only after confirmation", async () => {
    const hostAccountId = await newHostAccount(db);
    const sender = newSender();
    const pending = await pendingCode(hostAccountId);

    expect(pending).toMatchObject({ lineNumber: "+15550001111", message: `Link my Find Me a Time account: ${pending.code}` });
    expect(pending.code).toMatch(/^FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);

    const arrival = await im.deliver({ sender, text: pending.message });
    expect(arrival.outcome).toBe("link_received");
    const received = await im.status(hostAccountId);
    expect(received).toMatchObject({ sender: `•••• ${sender.slice(-4)}`, state: "received" });
    expect(await im.bindingOf(hostAccountId)).toBeNull();

    const [ack] = await im.outbox({ hostAccountId, kind: "link_received" });
    const { sent } = await im.send(ack!.id);
    expect(textOf(sent)).toEqual(["Got it. Go back to Find Me a Time in your browser and tap Confirm and link to finish."]);
    expect(sent[0]!.recipient).toEqual({ address: sender, spaceId: `any;-;${sender}` });

    const [link] = await db<{ id: string }[]>`select id from app.imessage_links where host_account_id = ${hostAccountId} and state = 'received'`;
    const confirmed = await im.command(hostAccountId, "imessage.link.confirm", { linkId: link!.id });
    expect(confirmed.ok).toBe(true);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ sender_hash: imessageHash(testTokenKey, "sender", sender), state: "active" });
    expect(await im.status(hostAccountId)).toMatchObject({ contactCard: null, delivery: null, sender: `•••• ${sender.slice(-4)}`, state: "linked" });

    const [linked] = await im.outbox({ hostAccountId, kind: "linked" });
    expect(textOf((await im.send(linked!.id)).sent)).toEqual([
      `You're connected! I'm Thyme, and we can set up your meetings right here. First, connect Google Calendar: ${calendarConnectUrl("http://localhost:3000")}`,
    ]);
  });

  it("welcomes a host still setting up into setup, Calendar first, and tells a ready host what Thyme can do", async () => {
    const welcomeOf = async (hostAccountId: string) => {
      await linkedHost(hostAccountId);
      const [linked] = await im.outbox({ hostAccountId, kind: "linked" });
      return textOf((await im.send(linked!.id)).sent);
    };
    expect(await welcomeOf(await newHostAccount(db))).toEqual([LINK_TEXTS.welcomeCalendar(calendarConnectUrl("http://localhost:3000"))]);

    const calendarOnly = await newHostAccount(db);
    await makeHostReady(db, calendarOnly);
    await db`delete from app.host_settings where host_account_id = ${calendarOnly}`;
    expect(await welcomeOf(calendarOnly)).toEqual([LINK_TEXTS.welcomeSetup]);

    const ready = await newHostAccount(db);
    await makeHostReady(db, ready);
    expect(await welcomeOf(ready)).toEqual(["Linked. Send help for what I can do here."]);
  });

  it("refuses an unknown, expired, replayed or group code and voids the attempt it names", async () => {
    const hostAccountId = await newHostAccount(db);
    const unknownSender = newSender();
    expect((await im.deliver({ sender: unknownSender, text: generateLinkCode() })).outcome).toBe("link_refused");

    const expired = await pendingCode(hostAccountId);
    await db`update app.imessage_links set expires_at = now() - interval '1 second' where host_account_id = ${hostAccountId} and state = 'pending'`;
    expect((await im.deliver({ sender: newSender(), text: expired.message })).outcome).toBe("link_refused");
    expect(await im.status(hostAccountId)).toMatchObject({ state: "none" });

    // A code posted in a group conversation voids its attempt, with no reply into the group.
    const group = await pendingCode(hostAccountId);
    const groupSender = newSender();
    expect((await im.deliver({ sender: groupSender, spaceType: "group", text: group.message })).outcome).toBe("link_refused");
    expect(await im.status(hostAccountId)).toMatchObject({ state: "none" });
    expect(await im.outbox({ recipientHash: imessageHash(testTokenKey, "sender", groupSender) })).toHaveLength(0);

    // The message that linked a sender, sent again, binds nothing more.
    const { hostAccountId: linkedId, message, sender } = await linkedHost();
    expect((await im.deliver({ sender, text: message })).outcome).toBe("link_refused");
    expect(await im.bindingOf(linkedId)).toMatchObject({ state: "active" });
  });

  it("treats the same sender sending the code again as the same arrival", async () => {
    const hostAccountId = await newHostAccount(db);
    const sender = newSender();
    const { message } = await pendingCode(hostAccountId);
    await im.deliver({ sender, text: message });
    expect((await im.deliver({ sender, text: message })).outcome).toBe("link_received");
    expect(await im.status(hostAccountId)).toMatchObject({ state: "received" });
    expect(await im.outbox({ hostAccountId, kind: "link_received" })).toHaveLength(1);
  });

  it("sends one refusal per sender per day", async () => {
    const sender = newSender();
    await im.deliver({ sender, text: generateLinkCode() });
    await im.deliver({ sender, text: generateLinkCode() });
    expect(await im.outbox({ kind: "link_refused", recipientHash: imessageHash(testTokenKey, "sender", sender) })).toHaveLength(1);
  });

  it("keeps a sender bound to one host: another host's code is voided and the binding unchanged", async () => {
    const { hostAccountId: first, sender } = await linkedHost();
    const second = await newHostAccount(db);
    const pending = await pendingCode(second);

    expect((await im.deliver({ sender, text: pending.message })).outcome).toBe("link_refused");
    expect(await im.status(second)).toMatchObject({ state: "none" });
    expect(await im.bindingOf(first)).toMatchObject({ state: "active" });
  });

  it("refuses a confirmation once its window has passed", async () => {
    const hostAccountId = await newHostAccount(db);
    const { message } = await pendingCode(hostAccountId);
    await im.deliver({ sender: newSender(), text: message });
    const [link] = await db<{ id: string }[]>`
      update app.imessage_links set confirm_by = now() - interval '1 second' where host_account_id = ${hostAccountId} and state = 'received' returning id
    `;
    const outcome = await im.command(hostAccountId, "imessage.link.confirm", { linkId: link!.id });
    expect(outcome).toMatchObject({ error: { category: "stale_revision" }, ok: false });
    expect(await im.bindingOf(hostAccountId)).toBeNull();
  });

  it("limits codes to five an hour and replays an exact retry", async () => {
    const hostAccountId = await newHostAccount(db);
    const first = await im.command(hostAccountId, "imessage.link.create", {}, "retry-1");
    const replay = await im.command(hostAccountId, "imessage.link.create", {}, "retry-1");
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(first.ok && replay.ok && first.result).toEqual(replay.ok && replay.result);

    for (let index = 0; index < 4; index += 1) expect((await im.command(hostAccountId, "imessage.link.create")).ok).toBe(true);
    expect(await im.command(hostAccountId, "imessage.link.create")).toMatchObject({ error: { category: "rate_limited" }, ok: false });
  });
});

describe("the fallback code", () => {
  async function codeSentTo(hostAccountId: string, number: string) {
    const sent = await im.command(hostAccountId, "imessage.link.send_code", { number });
    expect(sent.ok).toBe(true);
    const rows = await im.outbox({ hostAccountId, kind: "fallback_code" });
    const { sent: sends } = await im.send(rows.at(-1)!.id);
    return /(\d{6})/.exec(textOf(sends)[0] ?? "")![1]!;
  }

  it("sends a code the browser never sees, and binds the number when it is typed back", async () => {
    const hostAccountId = await newHostAccount(db);
    const number = newSender();
    expect(await im.command(hostAccountId, "imessage.link.send_code", { number: "12345" })).toMatchObject({ error: { category: "invalid_input" } });

    const code = await codeSentTo(hostAccountId, number);
    const status = await im.status(hostAccountId);
    expect(status).toMatchObject({ number: `•••• ${number.slice(-4)}`, send: "sent", sendsLeft: 2, state: "fallback" });
    expect(JSON.stringify(status)).not.toContain(code);

    const verified = await im.command(hostAccountId, "imessage.link.verify_code", { code });
    expect(verified).toMatchObject({ ok: true, result: { status: "linked" } });
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ sender_hash: imessageHash(testTokenKey, "sender", number), space_ciphertext: null, state: "active" });
  });

  it("spaces and limits resends and voids the code after five wrong entries", async () => {
    const hostAccountId = await newHostAccount(db);
    const number = newSender();
    const code = await codeSentTo(hostAccountId, number);
    expect(await im.command(hostAccountId, "imessage.link.send_code", { number })).toMatchObject({ error: { category: "rate_limited" } });
    expect(await im.command(hostAccountId, "imessage.link.send_code", { resend: true })).toMatchObject({ error: { category: "rate_limited" } });

    const wrong = code === "000000" ? "111111" : "000000";
    for (let left = 4; left >= 0; left -= 1) {
      expect(await im.command(hostAccountId, "imessage.link.verify_code", { code: wrong })).toMatchObject({ result: { attemptsLeft: left, status: "wrong" } });
    }
    expect(await im.command(hostAccountId, "imessage.link.verify_code", { code })).toMatchObject({ error: { category: "stale_revision" } });
    expect(await im.bindingOf(hostAccountId)).toBeNull();
  });

  it("resends to the open attempt's number after the spacing, with a new code", async () => {
    const hostAccountId = await newHostAccount(db);
    const number = newSender();
    const first = await codeSentTo(hostAccountId, number);
    await db`update app.imessage_links set last_sent_at = now() - interval '61 seconds' where host_account_id = ${hostAccountId} and state = 'pending'`;
    expect((await im.command(hostAccountId, "imessage.link.send_code", { resend: true })).ok).toBe(true);
    const rows = await im.outbox({ hostAccountId, kind: "fallback_code" });
    const { sent } = await im.send(rows.at(-1)!.id);
    expect(sent[0]!.recipient.address).toBe(number);
    expect(await im.status(hostAccountId)).toMatchObject({ sendsLeft: 1 });
    expect(await im.command(hostAccountId, "imessage.link.verify_code", { code: first })).toMatchObject({ result: { status: "wrong" } });
  });

  it("caps sends per host and per line", async () => {
    const hostAccountId = await newHostAccount(db);
    expect(await im.command(hostAccountId, "imessage.link.send_code", { number: newSender() }, undefined, 0)).toMatchObject({
      error: { category: "rate_limited" },
    });
    for (let index = 0; index < 5; index += 1) {
      expect((await im.command(hostAccountId, "imessage.link.send_code", { number: newSender() })).ok).toBe(true);
    }
    expect(await im.command(hostAccountId, "imessage.link.send_code", { number: newSender() })).toMatchObject({ error: { category: "rate_limited" } });
  });

  it("sends nothing to a number another host has linked, shows it sent, and counts it", async () => {
    const { sender } = await linkedHost();
    const other = await newHostAccount(db);
    expect((await im.command(other, "imessage.link.send_code", { number: sender })).ok).toBe(true);
    expect(await im.outbox({ hostAccountId: other, kind: "fallback_code" })).toEqual([expect.objectContaining({ state: "suppressed" })]);
    expect(await im.status(other)).toMatchObject({ send: "sent", state: "fallback" });
    expect(photon.sentTo(sender)).toHaveLength(0);
  });
});

describe("unlinking and the contact card", () => {
  it("makes an unlink wait for a message already being processed", async () => {
    const { hostAccountId, sender } = await linkedHost();
    const holder = db.begin(async (tx) => {
      await lockActiveBindingOfSender(tx, imessageHash(testTokenKey, "sender", sender));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    const unlinked = await im.command(hostAccountId, "imessage.unlink");
    await holder;
    expect(unlinked).toMatchObject({ ok: true, result: { unlinked: true } });
    expect(Date.now() - started).toBeGreaterThan(300);
  });

  it("unlinks in the database only and suppresses what was not sent", async () => {
    const { hostAccountId } = await linkedHost();
    const [linked] = await im.outbox({ hostAccountId, kind: "linked" });
    expect(linked!.state).toBe("queued");

    expect(await im.command(hostAccountId, "imessage.unlink")).toMatchObject({ ok: true, result: { unlinked: true } });
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ state: "unlinked" });
    expect((await im.outbox({ hostAccountId, kind: "linked" }))[0]).toMatchObject({ state: "suppressed" });
    expect(await im.status(hostAccountId)).toMatchObject({ state: "none" });
  });

  it("queues one contact card and refuses another while it is on its way", async () => {
    const { hostAccountId } = await linkedHost();
    expect((await im.command(hostAccountId, "imessage.contact_card.share")).ok).toBe(true);
    expect(await im.command(hostAccountId, "imessage.contact_card.share")).toMatchObject({ error: { category: "rate_limited" } });
    expect(await im.status(hostAccountId)).toMatchObject({ contactCard: { state: "queued" } });

    const [card] = await im.outbox({ hostAccountId, kind: "contact_card" });
    expect(textOf((await im.send(card!.id)).sent)).toEqual(["[contact_card]"]);
    expect(await im.status(hostAccountId)).toMatchObject({ contactCard: { state: "sent" } });

    // Once that card has a final outcome, the host may share again.
    photon.nextSend({ category: "provider_rejected", status: 400 });
    expect((await im.command(hostAccountId, "imessage.contact_card.share")).ok).toBe(true);
    const cards = await im.outbox({ hostAccountId, kind: "contact_card" });
    expect(cards).toHaveLength(2);
    await im.send(cards[1]!.id);
    expect(await im.status(hostAccountId)).toMatchObject({ contactCard: { state: "failed" } });
    expect((await im.command(hostAccountId, "imessage.contact_card.share")).ok).toBe(true);
    expect(await im.outbox({ hostAccountId, kind: "contact_card" })).toHaveLength(3);

    const unlinked = await newHostAccount(db);
    expect(await im.command(unlinked, "imessage.contact_card.share")).toMatchObject({ error: { category: "invalid_input" } });
  });

  it("shows the latest failed message to the linked conversation", async () => {
    const { hostAccountId } = await linkedHost();
    const [linked] = await im.outbox({ hostAccountId, kind: "linked" });
    photon.nextSend({ category: "not_imessage", status: 422 });
    await im.send(linked!.id);
    expect(await im.status(hostAccountId)).toMatchObject({ delivery: { state: "failed" }, state: "linked" });
  });
});
