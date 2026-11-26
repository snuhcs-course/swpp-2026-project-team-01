import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MacRelay, type Post } from "../../apps/kakaotalk-mac-relay/src/relay";
import { signedHeaders } from "../../apps/kakaotalk-mac-relay/src/signer";
import { FakeKakao, FakeMessenger, FakeUi, RECORDED } from "../../apps/kakaotalk-mac-relay/src/testing";
import { KAKAOTALK_PREFIX } from "../../lib/contracts/messaging-channel";
import { runCommand } from "../../lib/server/commands";
import { calendarConnectUrl, imessageCommands, LINK_TEXTS, readImessageStatus } from "../../lib/server/imessage-links";
import { IMESSAGE_SEND_JOB, recordOutbound } from "../../lib/server/imessage-outbox";
import {
  type KakaoTalkOutboxDependencies,
  queueKakaoTalkLeave,
  receiveKakaoTalkClaim,
  receiveKakaoTalkHeartbeat,
  receiveKakaoTalkResult,
} from "../../lib/server/kakaotalk-outbox";
import { receiveKakaoTalkWebhook } from "../../lib/server/kakaotalk-receiver";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness } from "./support/imessage";
import { kakaotalkRelay, newKakaoTalkRoom, RELAY_INBOUND_SECRET, RELAY_OUTBOX_SECRET, TEST_KAKAOTALK_ID } from "./support/kakaotalk-relay";
import { testTokenKey } from "./support/requests";

// The Mac relay (host-kakaotalk-mac-relay task 3.4 and group 2) against the
// local stack: the daemon's own loop (apps/kakaotalk-mac-relay/src/relay.ts)
// signs with its own signer and calls the real routes, with a stand-in
// database (the rows recorded on the Mac mini) and a stand-in kakaocli. A host
// links by sending the code in a new 1:1 chat, the welcome and Thyme's reply
// land in that room, and a notice goes out with no nudge first. Around it: the
// standby relay's refusals, a switch of relays, a reply that lands in another
// room, a locked screen, and leaving a group.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);
const mac = kakaotalkRelay(db, { KAKAOTALK_ACTIVE_RELAY: "mac" });
const phone = kakaotalkRelay(db);
const channels = { imessage: null, kakaotalk: TEST_KAKAOTALK_ID, telegram: null, whatsapp: null };

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await db`delete from app.kakaotalk_relay_heartbeats`;
  await photon.close();
  await db.end();
});

// The routes as the deployed service answers them, for the daemon's signed POSTs.
function routes(deps: () => KakaoTalkOutboxDependencies): Post {
  return async (path, body, secret) => {
    const request = new Request(`http://127.0.0.1:2999${path}`, { body, headers: signedHeaders(secret, path, body, Date.now()), method: "POST" });
    const result = /^\/kakaotalk\/outbox\/([^/]+)\/result$/.exec(path);
    const response =
      path === "/kakaotalk/webhook"
        ? await receiveKakaoTalkWebhook(request, deps)
        : path === "/kakaotalk/outbox/claim"
          ? await receiveKakaoTalkClaim(request, deps)
          : path === "/kakaotalk/heartbeat"
            ? await receiveKakaoTalkHeartbeat(request, deps)
            : result
              ? await receiveKakaoTalkResult(request, decodeURIComponent(result[1]!), deps)
              : new Response(null, { status: 404 });
    const text = await response.text();
    return { body: text ? (JSON.parse(text) as unknown) : null, status: response.status };
  };
}

function macRelay(deps = mac.deps) {
  const kakao = new FakeKakao();
  const ui = new FakeUi(kakao);
  const messenger = new FakeMessenger(kakao);
  const relay = new MacRelay({
    config: { groupEvents: false, inboundSecret: RELAY_INBOUND_SECRET, outboxSecret: RELAY_OUTBOX_SECRET },
    db: kakao,
    landingMs: 50,
    landingStepMs: 10,
    messenger,
    now: Date.now,
    post: routes(deps),
    sleep: async () => {},
    store: { load: async () => null, save: async () => {} },
    ui,
  });
  return { kakao, messenger, relay, ui };
}

let current: ReturnType<typeof macRelay>;

beforeEach(async () => {
  await mac.quiet();
  current = macRelay();
  await current.relay.start();
  expect((await current.relay.beatOnce()).status).toBe(200);
});

function command(hostAccountId: string, operation: string, input: unknown = {}) {
  const commands = imessageCommands({
    kakaotalkAccountId: TEST_KAKAOTALK_ID,
    lineNumber: "",
    origin: "http://localhost:3000",
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

// Runs the receipt jobs the watcher's events stored, oldest first; their outcomes.
async function receipts(roomId: string) {
  const rows = await db<{ id: string }[]>`
    select id from app.imessage_receipts
    where message_id like ${`kakaotalk:${roomId}:log:%`} and outcome is null
    order by received_at, id
  `;
  const outcomes: string[] = [];
  for (const row of rows) {
    await im.runReceipt(row.id);
    const [after] = await db<{ outcome: string }[]>`select outcome from app.imessage_receipts where id = ${row.id}`;
    outcomes.push(after!.outcome);
  }
  return outcomes;
}

// Runs the send jobs that freeze a room's rows for the relay.
async function prepare(roomId: string) {
  const rows = await db<{ id: string }[]>`
    select o.id from app.imessage_outbox o
    join app.jobs j on j.kind = ${IMESSAGE_SEND_JOB} and j.dedupe_key = 'outbox:' || o.id::text and j.state = 'pending'
    where o.recipient_hash = ${mac.hash(roomId)} and o.state in ('waiting', 'queued')
    order by o.created_at, o.id
  `;
  for (const row of rows) await im.send(row.id);
}

async function rowOf(id: string) {
  const [row] = await db<{ state: string; failure_category: string | null; kind: string }[]>`
    select state, failure_category, kind from app.imessage_outbox where id = ${id}
  `;
  return row!;
}

// A host who adds the account and sends the code from a new 1:1 chat on the Mac.
async function linkedHost(name: string) {
  const { hostAccountId } = await hostWithUser(db);
  expect((await command(hostAccountId, "imessage.link.create", { channel: "kakaotalk" })).ok).toBe(true);
  const pending = await readImessageStatus(db, [testTokenKey], hostAccountId, channels);
  if (pending.state !== "pending") throw new Error(`Expected a pending code, got ${pending.state}.`);
  const roomId = newKakaoTalkRoom();
  const userId = String(910_000_000 + Math.floor(Math.random() * 1_000_000));
  current.kakao.addRoom({ chatId: roomId, directMemberUserId: userId, memberNames: [name] });
  current.kakao.add(roomId, userId, pending.code);
  expect(await current.relay.watchOnce()).toBe(1);
  expect(await receipts(roomId)).toEqual(["link_received"]);
  await prepare(roomId);
  const [binding] = await db<{ id: string }[]>`select id from app.imessage_bindings where host_account_id = ${hostAccountId} and state = 'active'`;
  return { bindingId: binding!.id, hostAccountId, roomId, userId };
}

describe("a host on the Mac relay", () => {
  it("links by the code, and the welcome and Thyme's reply land in the host's own room", async () => {
    const host = await linkedHost("박도현");
    expect(await readImessageStatus(db, [testTokenKey], host.hostAccountId, channels)).toMatchObject({ channel: "kakaotalk", sender: "박도현", state: "linked" });

    const welcome = await current.relay.claimOnce();
    expect(welcome).toMatchObject({ outcome: { outcome: "accepted" }, status: "done" });
    expect(current.messenger.sent.at(-1)).toEqual({ chatId: host.roomId, name: "박도현", text: LINK_TEXTS.welcomeCalendar(calendarConnectUrl("http://localhost:3000")) });
    expect(await current.relay.claimOnce()).toEqual({ status: "idle" });

    // The host writes; the text reaches the model marked [KakaoTalk]; the reply lands in the same room.
    current.kakao.add(host.roomId, host.userId, "Hello Thyme");
    expect(await current.relay.watchOnce()).toBe(1);
    expect(await receipts(host.roomId)).toEqual(["forwarded"]);
    const [input] = (await im.inputsOf(host.hostAccountId)).slice(-1);
    expect(input!.message).toBe(`${KAKAOTALK_PREFIX}Hello Thyme`);
    await im.endTurn(input!.id, "Hi! Let's set up your meetings.");
    await prepare(host.roomId);
    expect(await current.relay.claimOnce()).toMatchObject({ outcome: { outcome: "accepted" } });
    expect(current.kakao.messages_.at(-1)).toMatchObject({ authorId: RECORDED.account, chatId: host.roomId, text: "Hi! Let's set up your meetings." });
    // The relay's own reply is not forwarded back.
    expect(await current.relay.watchOnce()).toBe(0);

    // A notice the service starts goes out as content, with no nudge first.
    const { id } = await db.begin((tx) =>
      recordOutbound(tx, {
        bindingId: host.bindingId,
        dedupeKey: `test:${randomUUID()}`,
        hostAccountId: host.hostAccountId,
        kind: "notice",
        recipient: { address: host.roomId, spaceId: host.roomId },
        recipientHash: mac.hash(host.roomId),
        text: "Request 6ADSRV from Eunwoo: Tuesday 3pm, Gangnam.",
        tokenKey: testTokenKey,
      }),
    );
    await prepare(host.roomId);
    expect(await current.relay.claimOnce()).toMatchObject({ id, outcome: { outcome: "accepted" } });
    expect(await rowOf(id)).toMatchObject({ state: "accepted" });
    const [nudges] = await db<{ count: number }[]>`select count(*)::int as count from app.imessage_outbox where kind = 'nudge' and recipient_hash = ${mac.hash(host.roomId)}`;
    expect(nudges!.count).toBe(0);
  });

  it("reports a reply that lands in another room as uncertain, never resends it, and lists it in the operator snapshot", async () => {
    const host = await linkedHost("Wrong Room Host");
    current.messenger.into = RECORDED.group;
    const result = await current.relay.claimOnce();
    expect(result).toMatchObject({ outcome: { outcome: "uncertain", reason: "wrong_room" }, status: "done" });
    const id = (result as { id: string }).id;
    expect(await rowOf(id)).toMatchObject({ failure_category: "relay_wrong_room", state: "uncertain" });
    expect(await current.relay.claimOnce()).toEqual({ status: "idle" });
    const [snapshot] = await db<{ value: { categories: { name: string; count: number }[] } }[]>`select app.operator_diagnostics_snapshot(5) as value`;
    expect(snapshot!.value.categories.find((category) => category.name === "kakaotalk_wrong_room")!.count).toBeGreaterThan(0);
    expect(host.roomId).not.toBe(RECORDED.group);
  });

  it("keeps a message queued, with no nudge, while the host's name is not unique", async () => {
    const host = await linkedHost("Kim");
    current.kakao.addRoom({ chatId: newKakaoTalkRoom(), directMemberUserId: "77", memberNames: ["Kim Jisoo"], memberWrote: true });
    expect(await current.relay.claimOnce()).toEqual({ status: "idle" });
    expect(current.messenger.sent).toEqual([]);
    const [open] = await db<{ kind: string; state: string }[]>`select kind, state from app.imessage_outbox where recipient_hash = ${mac.hash(host.roomId)} order by created_at`;
    expect(open).toMatchObject({ kind: "linked", state: "queued" });
  });

  it("claims nothing while the screen is locked, and the service hands out nothing to a locked Mac", async () => {
    await linkedHost("Locked Host");
    current.ui.probed = { ...current.ui.probed, locked: true };
    expect((await current.relay.beatOnce()).status).toBe(200);
    expect(await current.relay.claimOnce()).toEqual({ status: "locked" });
    // A claim that says unlocked still gets nothing while the last heartbeat said locked.
    const body = JSON.stringify({ locked: false, memberRooms: [], postedRooms: [], relay: "mac", replyableRooms: [] });
    const answer = await routes(mac.deps)("/kakaotalk/outbox/claim", body, RELAY_OUTBOX_SECRET);
    expect(answer.status).toBe(204);
    current.ui.probed = { ...current.ui.probed, locked: false };
    await current.relay.beatOnce();
    expect(await current.relay.claimOnce()).toMatchObject({ outcome: { outcome: "accepted" } });
  });
});

describe("one active relay", () => {
  it("refuses the standby phone's events, claims and heartbeats with 409", async () => {
    const roomId = newKakaoTalkRoom();
    const event = phone.message(roomId, "hello");
    const standby = await receiveKakaoTalkWebhook(phone.signed("/kakaotalk/webhook", JSON.stringify(event), RELAY_INBOUND_SECRET), mac.deps);
    expect(standby.status).toBe(409);
    expect(await standby.json()).toEqual({ status: "standby" });
    const [receipt] = await db`select 1 from app.imessage_receipts where message_id = ${`kakaotalk:${event.eventId}`}`;
    expect(receipt).toBeUndefined();
    const claim = await receiveKakaoTalkClaim(phone.signed("/kakaotalk/outbox/claim", '{"postedRooms":[],"locked":false}', RELAY_OUTBOX_SECRET), mac.deps);
    expect(claim.status).toBe(409);
    const beat = await receiveKakaoTalkHeartbeat(
      phone.signed("/kakaotalk/heartbeat", '{"listenerEnabled":true,"accessibilityEnabled":true,"locked":false}', RELAY_OUTBOX_SECRET),
      mac.deps,
    );
    expect(beat.status).toBe(409);
    const [row] = await db<{ relay_kind: string }[]>`select relay_kind from app.kakaotalk_relay_heartbeats`;
    expect(row!.relay_kind).toBe("mac");
  });

  it("refuses the Mac relay while the phone is active, and the log-form ID from the phone", async () => {
    const standby = macRelay(phone.deps);
    await standby.relay.start();
    expect((await standby.relay.beatOnce()).status).toBe(409);
    expect(await standby.relay.claimOnce()).toEqual({ status: "standby" });
    const forged = { eventId: "486083133936417:log:3982372862361772034", isGroup: false, postedAt: new Date().toISOString(), roomId: "486083133936417", senderName: "X", text: "x" };
    expect((await phone.post(forged)).status).toBe(400);
  });

  it("hands out nothing after a switch until the new relay beats, and takes the old relay's report by its token", async () => {
    const host = await linkedHost("Switch Host");
    // The phone is active and holds the welcome's lease.
    await phone.heartbeat();
    phone.posted.add(host.roomId);
    const leased = await phone.claim();
    expect(leased).toMatchObject({ mode: "reply", roomId: host.roomId });
    // The deployment switches to the Mac: nothing goes out before its first heartbeat.
    expect(await current.relay.claimOnce()).toEqual({ status: "idle" });
    const report = await receiveKakaoTalkResult(
      phone.signed(`/kakaotalk/outbox/${leased!.id}/result`, JSON.stringify({ leaseToken: leased!.leaseToken, outcome: "accepted" }), RELAY_OUTBOX_SECRET),
      leased!.id,
      mac.deps,
    );
    expect(report.status).toBe(200);
    await current.relay.beatOnce();
    current.kakao.add(host.roomId, host.userId, "after the switch");
    await current.relay.watchOnce();
    expect(await receipts(host.roomId)).toEqual(["forwarded"]);
  });

  it("accepts the Mac's membership event and stores nothing", async () => {
    const event = { activeMembersCount: 5, eventId: `${RECORDED.group}:members:3982014812382740481`, kind: "room_members", memberUserIds: ["900000003"], relay: "mac", roomId: RECORDED.group };
    const answer = await routes(mac.deps)("/kakaotalk/webhook", JSON.stringify(event), RELAY_INBOUND_SECRET);
    expect(answer.status).toBe(200);
    const [receipt] = await db`select 1 from app.imessage_receipts where message_id like ${`kakaotalk:${RECORDED.group}%`}`;
    expect(receipt).toBeUndefined();
  });
});

describe("leaving a group", () => {
  it("leaves through the Mac relay, and suppresses a request for a room it no longer lists", async () => {
    const id = await queueKakaoTalkLeave(db, testTokenKey, RECORDED.group, `leave:${randomUUID()}`);
    expect(await current.relay.claimOnce()).toMatchObject({ id, outcome: { outcome: "accepted" } });
    expect(current.ui.left).toEqual(["테스트 그룹"]);
    expect(await rowOf(id!)).toMatchObject({ kind: "leave_room", state: "accepted" });

    const again = await queueKakaoTalkLeave(db, testTokenKey, RECORDED.group, `leave:${randomUUID()}`);
    expect(await current.relay.claimOnce()).toEqual({ status: "idle" });
    expect(await rowOf(again!)).toMatchObject({ failure_category: "not_member", state: "suppressed" });
  });

  it("records one request per dedupe key, and suppresses it while the phone is active", async () => {
    const key = `leave:${randomUUID()}`;
    const id = await queueKakaoTalkLeave(db, testTokenKey, RECORDED.group, key);
    expect(await queueKakaoTalkLeave(db, testTokenKey, RECORDED.group, key)).toBeNull();
    await phone.heartbeat();
    expect(await phone.claim()).toBeNull();
    expect(await rowOf(id!)).toMatchObject({ failure_category: "unsupported", state: "suppressed" });
  });
});
