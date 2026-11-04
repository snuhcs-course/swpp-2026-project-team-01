import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { helpText, requestRef, settingsRef, STOP_TEXTS } from "../../lib/server/imessage-commands";
import { CHANNEL_TEXTS } from "../../lib/server/imessage-receipts";
import { recordOutbound } from "../../lib/server/imessage-outbox";
import { computeSetupProposal } from "../../lib/server/setup";
import { TYPING_MAX } from "../../lib/server/telegram-jobs";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { type FakeTelegram, startFakeTelegram } from "./support/fake-telegram";
import { imessageHarness } from "./support/imessage";
import { testTokenKey } from "./support/requests";
import { prepareReviewableHost, seedHost, setupDependencies } from "./support/setup-host";
import { newTelegramUpdateId, newTelegramUser, telegramBlocked, telegramCallback, telegramMessage } from "./support/telegram";
import { sentTexts, telegramHarness } from "./support/telegram-host";

// The Telegram chat as a host channel (host-telegram-channel task 4.2, design 8
// to 10, D10 and D12): commands work with a leading "/" and the bot's mention;
// setup works over Telegram, its plain text reaching the setup discussion with
// the [Telegram] prefix while typing shows until the reply is queued; the
// settings review carries Confirm settings; stop, /stop and blocking the bot end
// the binding; requester text with markup reaches Telegram literally; a thanks
// gets a 👍 reaction and no turn; and a notice that needs nothing is silent.

const db = testDatabase();
let photon: FakePhoton;
let telegram: FakeTelegram;
let google: FakeGoogle;
let setupDeps: ReturnType<typeof setupDependencies>;
const im = imessageHarness(db, () => photon, { receipt: () => ({ setup: setupDeps }) });
const tg = telegramHarness(db, im, () => telegram);

beforeAll(async () => {
  photon = await startFakePhoton();
  telegram = await startFakeTelegram();
  google = await startFakeGoogle();
  setupDeps = setupDependencies(db, google);
});

afterAll(async () => {
  await photon.close();
  await telegram.close();
  await google.close();
  await db.end();
});

// A seeded host with an active Telegram binding; userId is the Telegram user.
async function linkedHost() {
  const host = await seedHost(db, setupDeps, google);
  return { ...(await tg.bind(host.hostAccountId)), host, hostAccountId: host.hostAccountId };
}

async function bindingState(bindingId: string) {
  const [row] = await db<{ state: string; sender_ciphertext: string | null }[]>`
    select state, sender_ciphertext from app.imessage_bindings where id = ${bindingId}
  `;
  return row!;
}

describe("commands on Telegram", () => {
  it("accepts a leading slash and the bot's mention, as the command menu sends them", async () => {
    const { userId } = await linkedHost();

    for (const text of ["requests", "/requests", "/requests@findmeatime_bot"]) {
      expect((await tg.deliver(telegramMessage({ text, userId }))).outcome).toBe("command");
    }
    expect(sentTexts(await tg.flush(userId))).toEqual(["You have no open requests.", "You have no open requests.", "You have no open requests."]);

    await tg.deliver(telegramMessage({ text: "/help", userId }));
    const [help] = sentTexts(await tg.flush(userId));
    expect(help).toBe(helpText("http://localhost:3000", "en", true));
    expect(help).toContain("You can also tap Approve, Decline or Show details under a proposal.");
    expect(help).not.toBe(helpText("http://localhost:3000", "en"));
  });

  it("ends the binding on stop and on /stop, suppressing what was queued", async () => {
    for (const text of ["stop", "/stop"]) {
      const { bindingId, hostAccountId, chatId, userId } = await linkedHost();
      const { id: queued } = await db.begin((tx) =>
        recordOutbound(tx, {
          bindingId,
          dedupeKey: `test:${crypto.randomUUID()}`,
          hostAccountId,
          kind: "notice",
          recipient: { address: chatId, spaceId: chatId },
          recipientHash: tg.hash(userId),
          text: "A summary still queued",
          tokenKey: testTokenKey,
        }),
      );

      expect((await tg.deliver(telegramMessage({ text, userId }))).outcome).toBe("command");
      expect(await bindingState(bindingId)).toEqual({ sender_ciphertext: null, state: "unlinked" });
      expect((await tg.outbox(userId)).find((row) => row.id === queued)).toMatchObject({ failure_category: "unlinked", state: "suppressed" });
      expect(sentTexts(await tg.flush(userId))).toEqual([STOP_TEXTS.telegram]);

      // The next message is from an unlinked sender.
      await tg.deliver(telegramMessage({ text: "requests", userId }));
      expect(sentTexts(await tg.flush(userId))).toEqual([CHANNEL_TEXTS.unlinkedTelegram]);
    }
  });

  it("ends the binding when the host blocks the bot, sending nothing", async () => {
    const { bindingId, hostAccountId, chatId, userId } = await linkedHost();
    const { id: queued } = await db.begin((tx) =>
      recordOutbound(tx, {
        bindingId,
        dedupeKey: `test:${crypto.randomUUID()}`,
        hostAccountId,
        kind: "notice",
        recipient: { address: chatId, spaceId: chatId },
        recipientHash: tg.hash(userId),
        text: "A summary still queued",
        tokenKey: testTokenKey,
      }),
    );

    expect((await tg.deliver(telegramBlocked({ userId }))).outcome).toBe("command");
    expect(await bindingState(bindingId)).toEqual({ sender_ciphertext: null, state: "unlinked" });
    expect((await tg.outbox(userId)).find((row) => row.id === queued)).toMatchObject({ failure_category: "blocked", state: "suppressed" });
    expect(await tg.flush(userId)).toEqual([]);

    // A blocking update from someone with no binding is recorded and answered with nothing.
    const stranger = newTelegramUser();
    expect((await tg.deliver(telegramBlocked({ userId: stranger }))).outcome).toBe("ignored");
    expect(await tg.outbox(stranger)).toEqual([]);
  });

  it("answers content other than text with Telegram's text-only reply", async () => {
    const { userId } = await linkedHost();
    const sticker = JSON.stringify({
      message: { chat: { id: userId, type: "private" }, date: 1_793_000_000, from: { first_name: "Host", id: userId, is_bot: false }, message_id: 11, sticker: { file_id: "x" } },
      update_id: newTelegramUpdateId(),
    });

    expect((await tg.deliver(sticker)).outcome).toBe("replied");
    expect(sentTexts(await tg.flush(userId))).toEqual([CHANNEL_TEXTS.textOnlyTelegram]);
  });

  it("reacts with 👍 to a message that only says thanks and starts no turn", async () => {
    const { chatId, hostAccountId, userId } = await linkedHost();

    expect((await tg.deliver(telegramMessage({ text: "Thanks!", userId }))).outcome).toBe("replied");
    expect(await im.inputsOf(hostAccountId)).toEqual([]);
    expect((await tg.flush(userId)).map((call) => [call.method, call.params])).toEqual([
      ["setMessageReaction", { chat_id: chatId, message_id: 10, reaction: [{ emoji: "👍", type: "emoji" }] }],
    ]);
  });
});

describe("setup over Telegram", () => {
  it("forwards plain text to the setup discussion with the [Telegram] prefix and shows typing until the reply is queued", async () => {
    const host = await linkedHost();
    const { userId } = host;

    await tg.deliver(telegramMessage({ text: "/setup", userId }));
    expect(sentTexts(await tg.flush(userId))[0]).toContain("We're now talking about your setup.");

    expect((await tg.deliver(telegramMessage({ text: "Thirty-minute meetings, please", userId }))).outcome).toBe("forwarded");
    const [input] = await im.inputsOf(host.hostAccountId);
    expect(input).toMatchObject({ message: "[Telegram] Thirty-minute meetings, please", request_id: null });
    // The seeded setup session was not started by the harness runtime; let it record events.
    if (!im.sessions.has(input!.session_id!)) im.sessions.set(input!.session_id!, { events: [], sent: [] });

    // Typing at once, then every five seconds while the reply waits, at most twelve times.
    expect((await tg.flush(userId)).map((call) => call.method)).toEqual(["sendChatAction"]);
    const [turn] = (await tg.outbox(userId)).filter((row) => row.kind === "turn");
    expect(turn).toMatchObject({ state: "waiting" });
    expect(await tg.runTyping(turn!.id)).toBe(1);
    expect(await tg.runTyping(turn!.id)).toBe(1);
    expect((await tg.flush(userId)).map((call) => call.method)).toEqual(["sendChatAction", "sendChatAction"]);

    // The turn ends: its reply is queued and the typing stops.
    await im.endTurn(input!.id, "Got it: 30 minutes.");
    await tg.runTyping(turn!.id);
    expect(await tg.runTyping(turn!.id)).toBe(0);
    const calls = await tg.send(turn!.id);
    expect(sentTexts(calls)).toEqual(["Got it: 30 minutes."]);
    expect((await tg.outbox(userId)).filter((row) => row.kind === "signal")).toHaveLength(3);
  });

  it("stops typing after twelve indicators", async () => {
    const host = await linkedHost();
    await tg.deliver(telegramMessage({ text: "What can you do?", userId: host.userId }));
    const [turn] = (await tg.outbox(host.userId)).filter((row) => row.kind === "turn");

    while ((await tg.runTyping(turn!.id)) > 0);
    expect((await tg.outbox(host.userId)).filter((row) => row.kind === "signal")).toHaveLength(TYPING_MAX);
  });

  it("puts Confirm settings under the settings review and saves from it", async () => {
    const host = await linkedHost();
    await prepareReviewableHost(db, host.host);
    const ref = settingsRef((await computeSetupProposal(db, host.hostAccountId))!.proposalHash);

    await tg.deliver(telegramMessage({ text: "/review", userId: host.userId }));
    const [review] = (await tg.flush(host.userId)).filter((call) => call.method === "sendMessage");
    expect(review!.params.text).toContain("If these look right, tell me to save them.");
    expect(review!.params.reply_markup).toEqual({ inline_keyboard: [[{ callback_data: `c:${ref}`, text: "Confirm settings" }]] });

    expect((await tg.deliver(telegramCallback({ data: `c:${ref}`, userId: host.userId }))).outcome).toBe("command");
    const calls = await tg.flush(host.userId);
    expect(sentTexts(calls)[0]).toMatch(/^Saved\. Your booking link is /);
    expect(calls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
    expect(await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`).toHaveLength(1);

    // The review's button is spent once settings were saved.
    expect(await tg.runRetirement(host.hostAccountId)).toBe(1);
    expect((await tg.flush(host.userId)).map((call) => call.method)).toEqual(["editMessageReplyMarkup"]);
  });
});

describe("summaries on Telegram", () => {
  it("sends requester text with markup as literal text", async () => {
    const purpose = "<b>Q4 plan</b> *now* [click](https://evil.test)";
    let userId = 0;
    const request = await agreedRequest(db, google, {
      beforeAgree: async (seeded) => {
        userId = (await tg.bind(seeded.hostAccountId)).userId;
      },
      details: { purpose },
    });
    await tg.runNotices(request.requestId);

    const [summary] = (await tg.flush(userId)).filter((call) => call.method === "sendMessage");
    expect(summary!.params.text).toContain(`Request ${requestRef(request.requestId)} from Grace Hopper: ${purpose}.`);
    expect(Object.keys(summary!.params).sort()).toEqual(["chat_id", "reply_markup", "text"]);
  });

  it("sends a booking confirmation silently and a decision with notification", async () => {
    const { bindingId, chatId, hostAccountId, userId } = await linkedHost();
    for (const event of ["booking_confirmed", "booking_failed"]) {
      await db.begin((tx) =>
        recordOutbound(tx, {
          bindingId,
          dedupeKey: `notice:${event}:${crypto.randomUUID()}:${crypto.randomUUID()}`,
          hostAccountId,
          kind: "notice",
          recipient: { address: chatId, spaceId: chatId },
          recipientHash: tg.hash(userId),
          text: event,
          tokenKey: testTokenKey,
        }),
      );
    }

    const sent = (await tg.flush(userId)).filter((call) => call.method === "sendMessage");
    expect(sent.map((call) => [call.params.text, call.params.disable_notification ?? false])).toEqual([
      ["booking_confirmed", true],
      ["booking_failed", false],
    ]);
  });
});
