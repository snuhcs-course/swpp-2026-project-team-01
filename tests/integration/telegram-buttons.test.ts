import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRequester } from "./support/scheduling";
import { CALLBACK_TEXTS, requestRef, reviewRef } from "../../lib/server/imessage-commands";
import { runCommand } from "../../lib/server/commands";
import { chooseTutorialCommand } from "../../lib/server/host-tutorial";
import { listHostRequests } from "../../lib/server/host-requests";
import { changeAgreementCommand } from "../../lib/server/request-proposals";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { type FakeTelegram, startFakeTelegram } from "./support/fake-telegram";
import { imessageHarness } from "./support/imessage";
import { hostCommandDeps } from "./support/setup-host";
import { newTelegramUpdateId, newTelegramUser, telegramCallback, telegramMessage } from "./support/telegram";
import { sentTexts, telegramHarness } from "./support/telegram-host";

// Decision buttons on Telegram (host-telegram-channel task 4.1, design 7, D8 and
// D9): the summary awaiting approval carries Approve, Decline and Show details
// bound to its version; a tap from the bound host runs exactly the command its
// data names and is answered; a tap on an older version decides nothing and
// shows the current proposal; a tap from anyone else is answered "Not linked";
// a replayed tap approves once; and once the proposal is decided, withdrawn or
// superseded, the buttons are removed from every message that showed them,
// never past Telegram's 48-hour edit limit.

const db = testDatabase();
let photon: FakePhoton;
let telegram: FakeTelegram;
let google: FakeGoogle;
const im = imessageHarness(db, () => photon);
const tg = telegramHarness(db, im, () => telegram);

beforeAll(async () => {
  photon = await startFakePhoton();
  telegram = await startFakeTelegram();
  google = await startFakeGoogle();
});

afterAll(async () => {
  await photon.close();
  await telegram.close();
  await google.close();
  await db.end();
});

// A host linked on Telegram before the requester agreed, so the summary awaiting
// approval went to Telegram with its buttons, and that message as sent.
async function awaitingOnTelegram() {
  let chat: Awaited<ReturnType<typeof tg.bind>> | null = null;
  const request = await agreedRequest(db, google, {
    beforeAgree: async (seeded) => {
      chat = await tg.bind(seeded.hostAccountId);
    },
  });
  const bound = chat!;
  await tg.runNotices(request.requestId);
  const calls = await tg.flush(bound.userId);
  const [notice] = (await tg.outbox(bound.userId)).filter((row) => row.kind === "notice");
  return { ...bound, calls, notice: notice!, ref: requestRef(request.requestId), request };
}

async function approvalsOf(requestId: string) {
  const [row] = await db<{ count: number }[]>`select count(*)::int as count from app.approvals where request_id = ${requestId}`;
  return row!.count;
}

async function stateOf(requestId: string) {
  const [row] = await db<{ state: string }[]>`select state from app.requests where id = ${requestId}`;
  return row!.state;
}

const answers = (calls: { method: string; params: Record<string, unknown> }[]) => calls.filter((call) => call.method === "answerCallbackQuery").map((call) => call.params);

describe("decision buttons", () => {
  it.each([
    ["a", "en", "You approved the sample request."],
    ["d", "en", "You declined the sample request."],
    ["stop", "en", "You ended the tutorial."],
    ["a", "ko", "샘플 요청을 승인했어요."],
  ])("keeps the sample selected and finishes it for %s (%s) without touching real requests", async (action, language, confirmation) => {
    let bound: Awaited<ReturnType<typeof tg.bind>> | undefined;
    const real = await agreedRequest(db, google, {
      beforeAgree: async ({ hostAccountId }) => { bound = await tg.bind(hostAccountId); },
    });
    const { hostAccountId } = real;
    const { bindingId, userId } = bound!;
    await db`update app.host_settings set tutorial_offered = true where host_account_id = ${hostAccountId}`;
    const started = await runCommand(hostCommandDeps(db, hostAccountId), chooseTutorialCommand("en", bindingId), {
      input: { start: true },
      resourceId: hostAccountId,
      retryKey: randomUUID(),
    });
    if (!started.ok || !started.result.requestId) throw new Error("sample did not start");
    const { requestId } = started.result;
    await tg.runNotices(requestId);
    const [message] = (await tg.flush(userId)).filter((call) => call.method === "sendMessage");
    expect(message?.params.text).toContain("Sample request");
    expect(message?.params.text).toContain("Ask me for more details");
    expect(message?.params.reply_markup).toMatchObject({
      inline_keyboard: [
        [{ text: "Approve" }, { text: "Decline" }],
        [{ text: "Show details" }],
      ],
    });
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ selected_request_id: requestId });

    await tg.runNotices(real.requestId);
    await tg.flush(userId);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ selected_request_id: requestId });

    if (language === "ko") {
      expect((await tg.deliver(telegramMessage({ text: "이 요청에 대해 알려주세요.", userId }))).outcome).toBe("forwarded");
      await tg.flush(userId);
    }

    const decision = action === "stop"
      ? telegramMessage({ text: "stop", userId })
      : telegramCallback({ callbackId: "cb-practice", data: `${action}:${reviewRef(requestId, 1)}`, userId });
    expect((await tg.deliver(decision)).outcome).toBe("command");
    const [reply] = sentTexts(await tg.flush(userId));
    expect(reply).toContain(confirmation);
    expect(reply).toContain(language === "ko"
      ? "실제 일정은 만들어지지 않았고, 게스트에게도 알림이 가지 않았어요."
      : "No calendar event was created and no guest was notified.");
    expect(await tg.runRetirement(requestId)).toBe(1);
    expect((await listHostRequests(db, hostAccountId)).map((item) => item.requestId)).toEqual([real.requestId]);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ state: "active" });
    expect(await approvalsOf(real.requestId)).toBe(0);
    expect(await approvalsOf(requestId)).toBe(0);
    expect(await db`select id from app.bookings where request_id = ${requestId}`).toEqual([]);
  });

  it("puts Approve, Decline and Show details under the summary awaiting approval", async () => {
    const { calls, notice, ref } = await awaitingOnTelegram();
    const [sent] = calls.filter((call) => call.method === "sendMessage");

    expect(sent!.params.text).toContain("Ready for your approval.");
    expect(sent!.params.reply_markup).toEqual({
      inline_keyboard: [
        [
          { callback_data: `a:${ref}-1`, text: "Approve" },
          { callback_data: `d:${ref}-1`, text: "Decline" },
        ],
        [{ callback_data: `s:${ref}`, text: "Show details" }],
      ],
    });
    // Plain text, and a summary that asks for a decision is not silent.
    expect(sent!.params).not.toHaveProperty("parse_mode");
    expect(sent!.params).not.toHaveProperty("disable_notification");
    expect(notice).toMatchObject({ buttons: { kind: "decision", ref, version: 1 }, provider_message_id: expect.stringMatching(/^\d+$/), state: "accepted" });
  });

  it("approves from a button exactly as approve <ref>-<version>, answers the tap and removes the buttons", async () => {
    const { chatId, notice, ref, request, userId } = await awaitingOnTelegram();

    const tapped = await tg.deliver(telegramCallback({ callbackId: "cb-approve", data: `a:${ref}-1`, userId }));
    expect(tapped.outcome).toBe("command");
    expect(await approvalsOf(request.requestId)).toBe(1);
    expect(await stateOf(request.requestId)).toBe("booking");

    const calls = await tg.flush(userId);
    expect(sentTexts(calls)).toEqual(["Approved. I'm adding it to your calendar and will tell you when it's confirmed."]);
    expect(answers(calls)).toEqual([{ callback_query_id: "cb-approve" }]);

    // The approval queued the retirement: the summary's keyboard is cleared, its text kept.
    expect(await tg.runRetirement(request.requestId)).toBe(1);
    const edits = (await tg.flush(userId)).filter((call) => call.method === "editMessageReplyMarkup");
    expect(edits.map((call) => call.params)).toEqual([{ chat_id: chatId, message_id: Number(notice.provider_message_id), reply_markup: { inline_keyboard: [] } }]);
    expect((await tg.outbox(userId)).find((row) => row.kind === "edit_markup")).toMatchObject({ dedupe_key: `edit:${notice.id}`, state: "accepted" });
  });

  it("declines from a button and removes the buttons", async () => {
    const { request, ref, userId } = await awaitingOnTelegram();

    expect((await tg.deliver(telegramCallback({ data: `d:${ref}-1`, userId }))).outcome).toBe("command");
    expect(await stateOf(request.requestId)).toBe("declined");
    expect(sentTexts(await tg.flush(userId))).toEqual(["Declined. The requester will be told; nothing was booked."]);

    await tg.runRetirement(request.requestId);
    expect((await tg.flush(userId)).map((call) => call.method)).toEqual(["editMessageReplyMarkup"]);
  });

  it("shows the details from a button and selects the request", async () => {
    const { ref, request, userId } = await awaitingOnTelegram();

    expect((await tg.deliver(telegramCallback({ data: `s:${ref}`, userId }))).outcome).toBe("command");
    const calls = await tg.flush(userId);
    const [summary] = calls.filter((call) => call.method === "sendMessage");
    expect(summary!.params.text).toContain(`Request ${ref} from Grace Hopper`);
    expect(summary!.params.reply_markup).toMatchObject({ inline_keyboard: [[{ callback_data: `a:${ref}-1` }, { callback_data: `d:${ref}-1` }], [{ callback_data: `s:${ref}` }]] });
    expect(answers(calls)).toHaveLength(1);
    expect(await approvalsOf(request.requestId)).toBe(0);
  });

  it("refuses a tap on an older version and shows the current proposal", async () => {
    const { ref, request, userId } = await awaitingOnTelegram();

    expect((await tg.deliver(telegramCallback({ callbackId: "cb-stale", data: `a:${ref}-7`, userId }))).outcome).toBe("command");
    expect(await approvalsOf(request.requestId)).toBe(0);

    const calls = await tg.flush(userId);
    expect(answers(calls)).toEqual([{ callback_query_id: "cb-stale", text: CALLBACK_TEXTS.stale }]);
    const [current] = calls.filter((call) => call.method === "sendMessage");
    expect(current!.params.text).toContain(`Proposal 1:`);
    expect(current!.params.reply_markup).toMatchObject({ inline_keyboard: [[{ callback_data: `a:${reviewRef(request.requestId, 1)}` }, expect.anything()], expect.anything()] });
  });

  it("refuses an approval once the requester reopened the proposal, and removes its buttons", async () => {
    const { ref, request, userId } = await awaitingOnTelegram();
    const [current] = await db<{ revision: number }[]>`select revision from app.requests where id = ${request.requestId}`;
    const changed = await asRequester(db, request.requestId, changeAgreementCommand, {}, { expectedRevision: current!.revision });
    expect(changed.ok).toBe(true);

    // Superseded: back to negotiating, so the summary's buttons go.
    expect(await tg.runRetirement(request.requestId)).toBe(1);
    expect((await tg.flush(userId)).map((call) => call.method)).toEqual(["editMessageReplyMarkup"]);

    // An old message's button tapped anyway decides nothing.
    await tg.deliver(telegramCallback({ data: `a:${ref}-1`, userId }));
    expect(await approvalsOf(request.requestId)).toBe(0);
    expect(await stateOf(request.requestId)).toBe("negotiating");
  });

  it("answers a tap from anyone but the bound host with Not linked and decides nothing", async () => {
    const { ref, request } = await awaitingOnTelegram();
    const stranger = newTelegramUser();

    expect((await tg.deliver(telegramCallback({ callbackId: "cb-stranger", data: `a:${ref}-1`, userId: stranger }))).outcome).toBe("unlinked_reply");
    expect(await approvalsOf(request.requestId)).toBe(0);
    const calls = await tg.flush(stranger);
    expect(calls.map((call) => [call.method, call.params])).toEqual([["answerCallbackQuery", { callback_query_id: "cb-stranger", text: CALLBACK_TEXTS.notLinked }]]);
  });

  it("approves once when a tap is redelivered or replayed after a restart", async () => {
    const { ref, request, userId } = await awaitingOnTelegram();
    const updateId = newTelegramUpdateId();
    const body = telegramCallback({ data: `a:${ref}-1`, updateId, userId });

    // Telegram's redelivery of the same update is one receipt.
    const receiptId = await tg.store(body);
    expect(await tg.store(body)).toBe(receiptId);
    expect(await db`select 1 from app.imessage_receipts where message_id = ${`update:${updateId}`}`).toHaveLength(1);

    // A restart after the approval committed but before the receipt's job did.
    await tg.processTwice(receiptId!);
    expect(await approvalsOf(request.requestId)).toBe(1);
    expect(await db`select 1 from app.bookings where request_id = ${request.requestId}`).toHaveLength(1);

    // A second tap on the same button, now that the request is booking.
    await tg.deliver(telegramCallback({ data: `a:${ref}-1`, userId }));
    expect(await approvalsOf(request.requestId)).toBe(1);
  });

  it("ignores a tap whose data names no command, and answers it", async () => {
    const { request, userId } = await awaitingOnTelegram();

    expect((await tg.deliver(telegramCallback({ data: "approve everything", userId }))).outcome).toBe("ignored");
    expect((await tg.flush(userId)).map((call) => call.method)).toEqual(["answerCallbackQuery"]);
    expect(await approvalsOf(request.requestId)).toBe(0);
  });

  it("never edits a message past Telegram's 48-hour limit", async () => {
    const { notice, ref, request, userId } = await awaitingOnTelegram();
    await tg.deliver(telegramCallback({ data: `d:${ref}-1`, userId }));
    await tg.flush(userId);
    await tg.runRetirement(request.requestId);
    await db`update app.imessage_outbox set completed_at = now() - interval '49 hours' where id = ${notice.id}`;

    expect(await tg.flush(userId)).toEqual([]);
    expect((await tg.outbox(userId)).find((row) => row.kind === "edit_markup")).toMatchObject({ failure_category: "edit_expired", state: "suppressed" });
  });
});
