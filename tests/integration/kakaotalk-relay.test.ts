import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KAKAOTALK_PREFIX } from "../../lib/contracts/messaging-channel";
import { runCommand } from "../../lib/server/commands";
import { calendarConnectUrl, imessageCommands, LINK_TEXTS, readImessageStatus } from "../../lib/server/imessage-links";
import { IMESSAGE_SEND_JOB, recordOutbound } from "../../lib/server/imessage-outbox";
import { CHANNEL_TEXTS } from "../../lib/server/imessage-receipts";
import { KAKAOTALK_NUDGE_TEXT } from "../../lib/server/kakaotalk";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness } from "./support/imessage";
import { kakaotalkRelay, newKakaoTalkRoom, TEST_KAKAOTALK_ID } from "./support/kakaotalk-relay";
import { testTokenKey } from "./support/requests";
import { newTelegramUser } from "./support/telegram";
import { channelHash } from "../../lib/server/photon-receiver";
import { createImessageSendHandler } from "../../lib/server/imessage-outbox";
import { SAMPLE_NOTICE_PREFIX } from "../../lib/server/imessage-notices";
import { receiveKakaoTalkHeartbeat } from "../../lib/server/kakaotalk-outbox";
import { RELAY_OUTBOX_SECRET } from "./support/kakaotalk-relay";
import { bindingContext } from "../../lib/server/imessage-links";
import { sealToken } from "../../lib/server/token-encryption";

// The KakaoTalk relay end to end against the local stack (host-kakaotalk-channel
// task 2.4): the relay stand-in links a host by sending the code in a 1:1 chat,
// gets the welcome through the reply action, forwards the host's message and
// sends Thyme's reply, and a notice the service starts goes out as the fixed
// nudge first and as content once the host writes back. Around it: signature
// replays, duplicates and changed payloads, group codes, leases that end, wrong
// and late reports, requeues, superseded summaries, ended bindings, relay
// health and a locked phone.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const relay = kakaotalkRelay(db);
const channels = { imessage: null, kakaotalk: TEST_KAKAOTALK_ID, telegram: null, whatsapp: null };

beforeAll(async () => {
  photon = await startFakePhoton();
});

beforeEach(async () => {
  await relay.quiet();
  await relay.heartbeat();
});

afterAll(async () => {
  await db`delete from app.kakaotalk_relay_heartbeats`;
  await photon.close();
  await db.end();
});

function command(hostAccountId: string, operation: string, input: unknown = {}) {
  const commands = imessageCommands({
    lineNumber: "",
    origin: "http://localhost:3000",
    kakaotalkAccountId: TEST_KAKAOTALK_ID,
    telegramUsername: "findmeatime_test_bot",
    tokenKey: testTokenKey,
    tokenKeys: [testTokenKey],
  });
  return runCommand({ authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db }, commands[operation]!, {
    input,
    resourceId: hostAccountId,
    retryKey: randomUUID(),
  });
}

const status = (hostAccountId: string) => readImessageStatus(db, [testTokenKey], hostAccountId, channels);

// Posts an event and runs its receipt job; the receipt's outcome.
async function deliver(event: ReturnType<typeof relay.message>) {
  const response = await relay.post(event);
  expect(response.status).toBe(200);
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${`kakaotalk:${event.eventId}`}`;
  await im.runReceipt(receipt!.id);
  const [after] = await db<{ outcome: string }[]>`select outcome from app.imessage_receipts where id = ${receipt!.id}`;
  return after!.outcome;
}

// Runs the send jobs of a room's open rows, which freeze them for the relay.
async function prepare(roomId: string) {
  const rows = await db<{ id: string }[]>`
    select o.id from app.imessage_outbox o
    join app.jobs j on j.kind = ${IMESSAGE_SEND_JOB} and j.dedupe_key = 'outbox:' || o.id::text and j.state = 'pending'
    where o.recipient_hash = ${relay.hash(roomId)} and o.state in ('waiting', 'queued')
    order by o.created_at, o.id
  `;
  for (const row of rows) await im.send(row.id);
}

async function rowOf(id: string) {
  const [row] = await db<{ state: string; failure_category: string | null; kind: string; claim_attempts: number; text_ciphertext: string | null }[]>`
    select state, failure_category, kind, claim_attempts, text_ciphertext from app.imessage_outbox where id = ${id}
  `;
  return row!;
}

// A host with a real Auth user, linked by sending the code from a new 1:1 chat.
async function linkedHost(senderName = "Test Host") {
  const { hostAccountId } = await hostWithUser(db);
  expect((await command(hostAccountId, "imessage.link.create", { channel: "kakaotalk" })).ok).toBe(true);
  const pending = await status(hostAccountId);
  if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
  const roomId = newKakaoTalkRoom();
  expect(await deliver(relay.message(roomId, pending.code, { senderName }))).toBe("link_received");
  await prepare(roomId);
  const [binding] = await db<{ id: string }[]>`select id from app.imessage_bindings where host_account_id = ${hostAccountId} and state = 'active'`;
  return { bindingId: binding!.id, code: pending.code, hostAccountId, roomId };
}

// A notice the service starts for the host's binding.
async function notice(host: { readonly bindingId: string; readonly hostAccountId: string; readonly roomId: string }, text: string, dedupeKey = `test:${randomUUID()}`, requestId: string | null = null) {
  const { id } = await db.begin((tx) =>
    recordOutbound(tx, {
      bindingId: host.bindingId,
      dedupeKey,
      hostAccountId: host.hostAccountId,
      kind: "notice",
      recipient: { address: host.roomId, spaceId: host.roomId },
      recipientHash: relay.hash(host.roomId),
      requestId,
      text,
      tokenKey: testTokenKey,
    }),
  );
  await prepare(host.roomId);
  return id;
}

describe("link, reply and a notice the service starts", () => {
  it("links by the code, replies through the notification, and nudges before content", async () => {
    const host = await linkedHost("박도현");
    expect(await status(host.hostAccountId)).toMatchObject({ channel: "kakaotalk", lineNumber: TEST_KAKAOTALK_ID, sender: "박도현", state: "linked" });

    // The welcome goes through the reply action of the code's notification.
    const welcome = await relay.claim();
    expect(welcome).toMatchObject({ displayName: "박도현", mode: "reply", roomId: host.roomId, text: LINK_TEXTS.welcomeCalendar(calendarConnectUrl("http://localhost:3000")) });
    expect((await relay.replied(welcome!)).body).toEqual({ state: "accepted" });
    expect(await relay.claim()).toBeNull();

    // The host writes; the text reaches the setup discussion marked [KakaoTalk], and Thyme's reply follows.
    expect(await deliver(relay.message(host.roomId, "Hello Thyme", { senderName: "박도현" }))).toBe("forwarded");
    const [input] = (await im.inputsOf(host.hostAccountId)).slice(-1);
    expect(input!.message).toBe(`${KAKAOTALK_PREFIX}Hello Thyme`);
    expect(await relay.claim()).toBeNull();
    await im.endTurn(input!.id, "Hi! Let's set up your meetings.");
    await prepare(host.roomId);
    const reply = await relay.claim();
    expect(reply).toMatchObject({ mode: "reply", roomId: host.roomId, text: "Hi! Let's set up your meetings." });
    await relay.replied(reply!);

    // With no notification posted, a notice the service starts is a nudge with no private content.
    const summary = await notice(host, "Request 6ADSRV from Eunwoo: Tuesday 3pm, Gangnam.");
    const nudge = await relay.claim();
    expect(nudge).toMatchObject({ displayName: "박도현", mode: "nudge", roomId: host.roomId, text: KAKAOTALK_NUDGE_TEXT });
    expect(nudge!.text).not.toContain("6ADSRV");
    await relay.replied(nudge!);
    expect((await rowOf(summary)).state).toBe("queued");
    // At most one nudge an hour: nothing more until the host writes.
    expect(await relay.claim()).toBeNull();

    // The host answers the nudge; the summary follows through the new notification's reply action.
    await deliver(relay.message(host.roomId, "ok", { senderName: "박도현" }));
    const content = await relay.claim();
    expect(content).toMatchObject({ id: summary, mode: "reply", roomId: host.roomId, text: "Request 6ADSRV from Eunwoo: Tuesday 3pm, Gangnam." });
    await relay.replied(content!);
    expect(await rowOf(summary)).toMatchObject({ state: "accepted", text_ciphertext: null });
  });

  it("updates the sealed name when the host renames their profile, and keeps the binding", async () => {
    const host = await linkedHost("Old Name");
    await deliver(relay.message(host.roomId, "thanks", { senderName: "New Name" }));
    expect(await status(host.hostAccountId)).toMatchObject({ sender: "New Name", state: "linked" });
  });

  it("answers a photo with the text-only reply, and nothing reaches the model", async () => {
    const host = await linkedHost();
    const before = (await im.inputsOf(host.hostAccountId)).length;
    expect(await deliver(relay.message(host.roomId, null, { nonText: true }))).toBe("replied");
    expect((await im.inputsOf(host.hostAccountId)).length).toBe(before);
    await prepare(host.roomId);
    await relay.replied((await relay.claim())!);
    relay.posted.add(host.roomId);
    expect((await relay.claim())?.text).toBe(CHANNEL_TEXTS.textOnly);
  });

  it("sends a setup review as a link to /app, and refuses to confirm it from the chat", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    await db.begin((tx) =>
      recordOutbound(tx, {
        bindingId: host.bindingId,
        dedupeKey: `slot-preview:${host.bindingId}:${randomUUID()}`,
        hostAccountId: host.hostAccountId,
        image: { language: "en", preview: {} as never, summary: "Next week's open times: Mon 10-12." },
        kind: "image",
        recipient: { address: host.roomId, spaceId: host.roomId },
        recipientHash: relay.hash(host.roomId),
        reviewHash: "a".repeat(64),
        tokenKey: testTokenKey,
      }),
    );
    await prepare(host.roomId);
    relay.posted.add(host.roomId);
    const review = await relay.claim();
    expect(review?.text).toBe("Next week's open times: Mon 10-12.\n\nKakaoTalk can't show the picture, so check the open times and confirm them on the web: http://localhost:3000/app");
  });

  it("ends a Telegram binding when the host links KakaoTalk, suppressing what it still had queued", async () => {
    const { hostAccountId } = await hostWithUser(db);
    const chatId = String(newTelegramUser());
    const bindingId = randomUUID();
    const sealed = sealToken(testTokenKey, chatId, bindingContext(bindingId)).ciphertext;
    await db`
      insert into app.imessage_bindings (id, channel, host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
      values (${bindingId}, 'telegram', ${hostAccountId}, ${channelHash(testTokenKey, "telegram", "sender", chatId)}, ${sealed}, ${testTokenKey.id})
    `;
    const { id: queued } = await db.begin((tx) =>
      recordOutbound(tx, {
        bindingId, dedupeKey: `test:${randomUUID()}`, hostAccountId, kind: "notice",
        recipient: { address: chatId, spaceId: chatId }, recipientHash: channelHash(testTokenKey, "telegram", "sender", chatId), text: "later", tokenKey: testTokenKey,
      }),
    );
    expect((await command(hostAccountId, "imessage.link.create", { channel: "kakaotalk" })).ok).toBe(true);
    const pending = await status(hostAccountId);
    if (pending.state !== "pending") throw new Error("Expected a pending code.");
    // The card says linking KakaoTalk ends the Telegram link.
    expect(pending.replaces).toBe("telegram");
    expect(await deliver(relay.message(newKakaoTalkRoom(), pending.code))).toBe("link_received");
    expect(await rowOf(queued)).toMatchObject({ failure_category: "replaced", state: "suppressed" });
    expect(await status(hostAccountId)).toMatchObject({ channel: "kakaotalk", state: "linked" });
  });
});

describe("the relay webhook", () => {
  it("stores the receipt and its job before 200, and a redelivery stores nothing", async () => {
    const event = relay.message(newKakaoTalkRoom(), "hello");
    expect((await relay.post(event)).status).toBe(200);
    const counts = async () => {
      const [row] = await db<{ receipts: number; jobs: number }[]>`
        select (select count(*)::int from app.imessage_receipts where message_id = ${`kakaotalk:${event.eventId}`} and channel = 'kakaotalk') as receipts,
               (select count(*)::int from app.jobs j join app.imessage_receipts r on j.dedupe_key = 'receipt:' || r.id::text
                where r.message_id = ${`kakaotalk:${event.eventId}`}) as jobs
      `;
      return row;
    };
    expect(await counts()).toEqual({ jobs: 1, receipts: 1 });
    expect((await relay.post(event)).status).toBe(200);
    expect(await counts()).toEqual({ jobs: 1, receipts: 1 });
  });

  it("refuses a changed payload under a stored ID and keeps the stored receipt", async () => {
    const event = relay.message(newKakaoTalkRoom(), "original");
    await relay.post(event);
    const [before] = await db<{ payload_sha256: string }[]>`select payload_sha256 from app.imessage_receipts where message_id = ${`kakaotalk:${event.eventId}`}`;
    expect((await relay.post({ ...event, text: "changed" })).status).toBe(409);
    const [after] = await db<{ payload_sha256: string }[]>`select payload_sha256 from app.imessage_receipts where message_id = ${`kakaotalk:${event.eventId}`}`;
    expect(after).toEqual(before);
  });

  it("stores two messages of one notification as two receipts in order", async () => {
    const roomId = newKakaoTalkRoom();
    const at = Date.now();
    const first = relay.message(roomId, "one", { at });
    const second = relay.message(roomId, "two", { at });
    expect(first.eventId).not.toBe(second.eventId);
    await relay.post(first);
    await relay.post(second);
    const rows = await db<{ message_id: string }[]>`
      select message_id from app.imessage_receipts where message_id in (${`kakaotalk:${first.eventId}`}, ${`kakaotalk:${second.eventId}`}) order by received_at, id
    `;
    expect(rows.map((row) => row.message_id)).toEqual([`kakaotalk:${first.eventId}`, `kakaotalk:${second.eventId}`]);
  });

  it("refuses a replayed nonce and changes nothing", async () => {
    const event = relay.message(newKakaoTalkRoom(), "once");
    const nonce = "ffeeddccbbaa99887766554433221100".replace(/^.{4}/, Math.random().toString(16).slice(2, 6).padEnd(4, "0"));
    expect((await relay.post(event, nonce)).status).toBe(200);
    expect((await relay.post({ ...event, text: "replayed" }, nonce)).status).toBe(401);
  });

  it("stores nothing from a group, and a code sent in a group voids its attempt", async () => {
    const roomId = newKakaoTalkRoom();
    const group = { ...relay.message(roomId, "hi all"), isGroup: true };
    expect((await relay.post(group)).status).toBe(200);
    const [stored] = await db<{ count: number }[]>`select count(*)::int as count from app.imessage_receipts where message_id = ${`kakaotalk:${group.eventId}`}`;
    expect(stored!.count).toBe(0);

    const { hostAccountId } = await hostWithUser(db);
    await command(hostAccountId, "imessage.link.create", { channel: "kakaotalk" });
    const pending = await status(hostAccountId);
    if (pending.state !== "pending") throw new Error("Expected a pending code.");
    expect((await relay.post(relay.voidCode(pending.code))).status).toBe(200);
    const [link] = await db<{ state: string }[]>`select state from app.imessage_links where host_account_id = ${hostAccountId}`;
    expect(link!.state).toBe("voided");
    expect(await status(hostAccountId)).toMatchObject({ state: "none" });
    const [bound] = await db<{ count: number }[]>`select count(*)::int as count from app.imessage_bindings where host_account_id = ${hostAccountId}`;
    expect(bound!.count).toBe(0);
  });
});

describe("the relay outbox", () => {
  it("hands out one message per chat at a time, in queue order", async () => {
    const host = await linkedHost();
    const welcome = (await relay.claim())!;
    const second = await notice(host, "second");
    expect(await relay.claim()).toBeNull();
    await relay.replied(welcome);
    relay.posted.add(host.roomId);
    expect((await relay.claim())?.id).toBe(second);
  });

  it("hands out a reply to a room whose reply action the relay still holds", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const queued = await notice(host, "Second message.");
    expect((await relay.claim({ rooms: [] }))?.mode).toBe("nudge");
    await db`update app.imessage_outbox set state = 'uncertain', lease_token_hash = null, lease_expires_at = null, recipient_ciphertext = null, text_ciphertext = null, completed_at = now() where kind = 'nudge' and recipient_hash = ${relay.hash(host.roomId)} and state = 'dispatching'`;
    const reply = await relay.claim({ replyable: [host.roomId], rooms: [] });
    expect([reply?.id, reply?.mode]).toEqual([queued, "reply"]);
  });

  it("makes a message whose lease ended uncertain, never hands it out again, and ignores a late report", async () => {
    await linkedHost();
    const claim = (await relay.claim())!;
    await db`update app.imessage_outbox set lease_expires_at = now() - interval '1 second' where id = ${claim.id}`;
    expect(await relay.claim()).toBeNull();
    expect(await rowOf(claim.id)).toMatchObject({ failure_category: "lease_expired", state: "uncertain" });
    expect(await relay.report(claim.id, claim.leaseToken, "accepted")).toEqual({ body: { state: "uncertain" }, status: 409 });
    expect((await rowOf(claim.id)).state).toBe("uncertain");
  });

  it("refuses a report with a wrong token, and accepts the right one only once", async () => {
    await linkedHost();
    const claim = (await relay.claim())!;
    expect((await relay.report(claim.id, "w".repeat(43), "accepted")).status).toBe(409);
    expect((await rowOf(claim.id)).state).toBe("dispatching");
    expect((await relay.report(claim.id, claim.leaseToken, "accepted")).status).toBe(200);
    expect((await relay.report(claim.id, claim.leaseToken, "failed")).status).toBe(409);
    expect((await rowOf(claim.id)).state).toBe("accepted");
  });

  it("requeues a message the relay could not start three times, then fails it", async () => {
    await linkedHost();
    let id = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = (await relay.claim())!;
      id = claim.id;
      expect((await relay.report(claim.id, claim.leaseToken, "not_started")).body).toEqual({ state: "queued" });
    }
    const last = (await relay.claim())!;
    expect(last.id).toBe(id);
    expect((await relay.report(last.id, last.leaseToken, "not_started")).body).toEqual({ state: "failed" });
    expect(await rowOf(id)).toMatchObject({ claim_attempts: 4, failure_category: "not_started", state: "failed" });
  });

  it("suppresses a summary whose proposal was superseded at claim time", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const [request] = await db<{ id: string }[]>`
      insert into app.requests (host_account_id, state, revision, details, requester_name, contact_email, expires_at)
      values (${host.hostAccountId}, 'awaiting_host_approval', 3, ${db.json({ purpose: "Coffee chat", durationMinutes: 30, mode: "online", location: null, linkPlan: { kind: "google_meet" }, timezone: "Asia/Seoul", language: "en", travelMode: "transit", windows: [] })}, 'Alex', 'alex@example.com', now() + interval '6 days')
      returning id
    `;
    const [evaluation] = await db<{ id: string }[]>`
      insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at) values (${request!.id}, 1, 1, 'completed', now()) returning id
    `;
    for (const version of [2, 3]) {
      await db`
        insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
        values (${request!.id}, ${version}, ${evaluation!.id}, ${`c${version}`}, now() + interval '1 day', now() + interval '1 day 30 minutes', ${db.json({})})
      `;
    }
    const stale = await notice(host, "Proposal 2", `notice:awaiting_approval:${request!.id}:v2`, request!.id);
    relay.posted.add(host.roomId);
    expect(await relay.claim()).toBeNull();
    expect(await rowOf(stale)).toMatchObject({ failure_category: "superseded", state: "suppressed" });
  });

  it("suppresses what was queued once the host sends stop, and confirms once", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const queued = await notice(host, "later");
    expect(await deliver(relay.message(host.roomId, "stop"))).toBe("command");
    await prepare(host.roomId);
    expect(await rowOf(queued)).toMatchObject({ state: "suppressed" });
    const confirmation = await relay.claim();
    expect(confirmation?.text).toBe("Unlinked. You won't get KakaoTalk messages from Find Me a Time.");
    await relay.replied(confirmation!);
    expect(await relay.claim()).toBeNull();
  });

  it("requeues a nudge the relay could not start three times, then fails it", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const content = await notice(host, "something private");
    let id = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const nudge = (await relay.claim())!;
      expect(nudge.mode).toBe("nudge");
      if (id) expect(nudge.id).toBe(id);
      id = nudge.id;
      expect((await relay.report(nudge.id, nudge.leaseToken, "not_started")).body).toEqual({ state: "queued" });
    }
    const last = (await relay.claim())!;
    expect(last.id).toBe(id);
    expect((await relay.report(last.id, last.leaseToken, "not_started")).body).toEqual({ state: "failed" });
    expect(await rowOf(id)).toMatchObject({ claim_attempts: 4, failure_category: "not_started", kind: "nudge", state: "failed" });
    expect((await rowOf(content)).state).toBe("queued");
  });

  it("drops a requeued nudge once the host writes, and sends the content instead", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const content = await notice(host, "something private");
    const nudge = (await relay.claim())!;
    await relay.report(nudge.id, nudge.leaseToken, "not_started");
    relay.posted.add(host.roomId);
    expect((await relay.claim())?.id).toBe(content);
    expect(await rowOf(nudge.id)).toMatchObject({ failure_category: "reply_posted", state: "suppressed" });
  });

  it("reports failed for an ambiguous nudge recipient", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    await notice(host, "something");
    const nudge = (await relay.claim())!;
    expect(nudge.mode).toBe("nudge");
    expect((await relay.report(nudge.id, nudge.leaseToken, "failed")).body).toEqual({ state: "failed" });
  });
});

describe("review fixes", () => {
  it("finds a newer chat behind a long queue of a quiet chat", async () => {
    const quietRoom = newKakaoTalkRoom();
    const hash = relay.hash(quietRoom);
    const rows = Array.from({ length: 520 }, () => {
      const id = randomUUID();
      return {
        channel: "kakaotalk",
        created_at: new Date(Date.now() - 3_600_000),
        dedupe_key: `quiet:${id}`,
        id,
        kind: "notice",
        recipient_ciphertext: sealToken(testTokenKey, JSON.stringify({ address: quietRoom, spaceId: quietRoom }), `imessage_outbox:${id}`).ciphertext,
        recipient_hash: hash,
        sealed_key_id: testTokenKey.id,
        text_ciphertext: sealToken(testTokenKey, "quiet", `imessage_outbox:${id}`).ciphertext,
      };
    });
    await db`insert into app.imessage_outbox ${db(rows)}`;
    const host = await linkedHost();
    expect(await relay.claim()).toMatchObject({ mode: "reply", roomId: host.roomId });
  });

  it("sends replies through a kept reply action while the phone is locked, and never a nudge", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const queued = await notice(host, "kept");
    await relay.heartbeat({ locked: true });
    expect(await relay.claim({ locked: true, rooms: [] })).toBeNull();
    expect(await relay.claim({ locked: true, replyable: [host.roomId], rooms: [] })).toMatchObject({ id: queued, mode: "reply" });
  });

  it("suppresses a sample request's notice at claim time once the tutorial request is not open", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const sample = await notice(host, "Try the sample", `${SAMPLE_NOTICE_PREFIX}${randomUUID()}:${host.bindingId}`, null);
    relay.posted.add(host.roomId);
    expect(await relay.claim()).toBeNull();
    expect(await rowOf(sample)).toMatchObject({ failure_category: "sample_finished", state: "suppressed" });
  });

  it("suppresses a requeued nudge whose chat has nothing left to send", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    const content = await notice(host, "soon gone");
    const nudge = (await relay.claim())!;
    await relay.report(nudge.id, nudge.leaseToken, "not_started");
    await db`update app.imessage_outbox set state = 'suppressed', failure_category = 'test', recipient_ciphertext = null, text_ciphertext = null, completed_at = now() where id = ${content}`;
    await relay.claim();
    expect(await rowOf(nudge.id)).toMatchObject({ failure_category: "no_content", state: "suppressed" });
  });

  it("names the binding a KakaoTalk code replaces, and leaves other channels' pending status unchanged", async () => {
    const host = await linkedHost();
    expect((await command(host.hostAccountId, "imessage.link.create", { channel: "telegram" })).ok).toBe(true);
    const pending = await readImessageStatus(db, [testTokenKey], host.hostAccountId, { ...channels, telegram: "findmeatime_test_bot" });
    expect(pending.state).toBe("pending");
    expect(pending).not.toHaveProperty("replaces");
  });

  it("leaves a leased row valid when its send job runs out of attempts", async () => {
    await linkedHost();
    const claim = (await relay.claim())!;
    await db.begin((tx) => createImessageSendHandler(() => im.sendDeps()).onExhausted!(tx, { payload: { outboxId: claim.id } } as never));
    const [row] = await db<{ state: string; lease_token_hash: string | null; lease_expires_at: Date | null }[]>`
      select state, lease_token_hash, lease_expires_at from app.imessage_outbox where id = ${claim.id}
    `;
    expect(row).toEqual({ lease_expires_at: null, lease_token_hash: null, state: "uncertain" });
  });

  it("accepts the previous outbox secret during rotation, and refuses it once removed", async () => {
    const rotating = kakaotalkRelay(db, { KAKAOTALK_RELAY_OUTBOX_SECRET: "rotated-secret", KAKAOTALK_RELAY_OUTBOX_SECRET_PREVIOUS: RELAY_OUTBOX_SECRET });
    const rotated = kakaotalkRelay(db, { KAKAOTALK_RELAY_OUTBOX_SECRET: "rotated-secret" });
    const body = JSON.stringify({ accessibilityEnabled: true, kakaoVersion: "26.10.1", listenerEnabled: true, locked: false, postedRooms: [] });
    const old = () => rotating.signed("/kakaotalk/heartbeat", body, RELAY_OUTBOX_SECRET);
    expect((await receiveKakaoTalkHeartbeat(old(), rotating.deps)).status).toBe(200);
    expect((await receiveKakaoTalkHeartbeat(rotating.signed("/kakaotalk/heartbeat", body, "rotated-secret"), rotating.deps)).status).toBe(200);
    expect((await receiveKakaoTalkHeartbeat(old(), rotated.deps)).status).toBe(401);
    expect((await receiveKakaoTalkHeartbeat(rotated.signed("/kakaotalk/heartbeat", body, "rotated-secret"), rotated.deps)).status).toBe(200);
  });
});

describe("relay health", () => {
  it("hands out nothing while the relay is silent or a service is disabled, alerts once, and resumes when it returns", async () => {
    await linkedHost();
    await db`update app.kakaotalk_relay_heartbeats set received_at = now() - interval '6 minutes'`;
    expect(await relay.claim()).toBeNull();
    const [down] = await db<{ down_cause: string; down_alerts: number }[]>`select down_cause, down_alerts from app.kakaotalk_relay_heartbeats`;
    expect(down!.down_cause).toBe("silent");
    expect(await relay.claim()).toBeNull();
    const [again] = await db<{ down_alerts: number }[]>`select down_alerts from app.kakaotalk_relay_heartbeats`;
    expect(again!.down_alerts).toBe(down!.down_alerts);
    const [queued] = await db<{ count: number }[]>`select count(*)::int as count from app.imessage_outbox where channel = 'kakaotalk' and state = 'queued'`;
    expect(queued!.count).toBeGreaterThan(0);

    expect((await relay.heartbeat({ accessibilityEnabled: false })).body).toEqual({ cause: "accessibility_disabled", status: "down" });
    expect(await relay.claim()).toBeNull();

    expect((await relay.heartbeat()).body).toEqual({ status: "up" });
    expect((await relay.claim())?.mode).toBe("reply");
  });

  it("claims no nudge while the phone is locked, and still claims replies for posted chats", async () => {
    const host = await linkedHost();
    await relay.replied((await relay.claim())!);
    await notice(host, "for later");
    await relay.heartbeat({ locked: true });
    expect(await relay.claim()).toBeNull();
    relay.posted.add(host.roomId);
    expect((await relay.claim({ locked: true }))?.mode).toBe("reply");
  });
});
