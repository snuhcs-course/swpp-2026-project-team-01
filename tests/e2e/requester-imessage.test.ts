import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { ConversationRuntime } from "../../lib/server/conversations";
import type { Database } from "../../lib/server/database";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { photonConfig } from "../../lib/server/photon";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { receiveTelegramWebhook } from "../../lib/server/telegram-receiver";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { unreachableSetup } from "../integration/support/imessage";
import {
  messagesEvent,
  newSender,
  newWhatsAppSender,
  signedWebhook,
  TEST_WEBHOOK_ID,
  TEST_WEBHOOK_SECRET,
  whatsAppEvent,
} from "../integration/support/photon";
import { runJob } from "../integration/support/requests";
import { newTelegramUser, telegramDelivery, telegramMessage, TEST_TELEGRAM_SECRET } from "../integration/support/telegram";
import { agreedReviewRequest } from "./support/host-review";
import { readyRequestHost } from "./support/requester";
import { expect, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

// **Get updates in iMessage** on the booking page (guest-flow-completion design
// 1; task 8.4's linking part), by keyboard at 390 and 1280 pixels, against the
// real web and agent services, the local stack and the Photon stand-in, for a
// request the guest agreed to (the line follows the agreement). The
// guest's message is driven here through the real receiver and receipt job, as
// Photon and the worker would: a desktop shows the number, the message and a QR
// code; the arrived message shows the masked sender, and only **Confirm and
// link** binds it; **Unlink iMessage** returns to the start. **Get updates in
// WhatsApp** (guest-whatsapp-link design 2) does the same with the WhatsApp
// number and a wa.me link, and **Get updates in Telegram** (guest-telegram-link
// design 2) with no number and the bot's telegram.me start link.

const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);
const LINE = "+15550001111";
const WHATSAPP = "15550002222";
const PHOTON = `http://127.0.0.1:${process.env.FAKE_PHOTON_PORT ?? "3106"}`;
const config = { ...photonConfig({}), apiUrl: PHOTON, lineNumber: LINE, whatsappNumber: WHATSAPP };
const runtime: ConversationRuntime = {
  createSession: async () => "unused",
  readEvents: () => (async function* () {})(),
  readRecordedEvents: () => (async function* () {})(),
  sendMessage: async () => undefined,
};

// The line appears once the guest agreed, while the request waits for the
// host's approval (guest-flow-completion U10).
async function agreedRequest(db: Database) {
  const host = await readyRequestHost(db);
  return agreedReviewRequest(db, host.hostAccountId);
}

// The guest's message, signed to the receiver and processed by the receipt job;
// with channel "whatsapp", a WhatsApp Business event from a contact ID.
async function guestSends(db: Database, sender: string, text: string, channel: "imessage" | "whatsapp" = "imessage") {
  const id = `msg_${randomUUID()}`;
  const event = channel === "whatsapp" ? whatsAppEvent({ id, sender, text }) : messagesEvent({ id, sender, text });
  const response = await receivePhotonWebhook(signedWebhook(event), () => ({
    config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID },
    db,
    tokenKey,
  }));
  expect(response.status).toBe(200);
  await runReceipt(db, id);
}

// The guest taps Start in Telegram: /start <code> through the Telegram webhook, then the receipt job.
async function guestStartsBot(db: Database, userId: number, code: string) {
  const body = telegramMessage({ firstName: "Grace", text: `/start ${code}`, userId, username: "grace" });
  const response = await receiveTelegramWebhook(telegramDelivery(body), () => ({ config: { secret: TEST_TELEGRAM_SECRET }, db, tokenKey }));
  expect(response.status).toBe(200);
  await runReceipt(db, `update:${(JSON.parse(body) as { update_id: number }).update_id}`);
}

async function runReceipt(db: Database, messageId: string) {
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${messageId}`;
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receipt!.id}`}`;
  await runJob(
    db,
    job!.id,
    createImessageReceiptHandler(() => ({
      config,
      conversation: { db, runtime, signingKey: "s".repeat(40) },
      db,
      env: {},
      notices: { origin: "http://localhost:3100", tokenKey, tokenKeys: [tokenKey] },
      origin: "http://localhost:3100",
      setup: unreachableSetup(db),
      tokenKey,
      tokenKeys: [tokenKey],
    })),
  );
}

async function pressByKeyboard(page: Page, name: string) {
  const button = page.getByRole("button", { exact: true, name });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
}

// The guest's number first (imessage-number-registration D1), typed by keyboard and sent with Enter.
async function entersNumber(page: Page) {
  const field = page.getByRole("textbox", { name: "Mobile number" });
  await expect(field).toBeVisible();
  await field.focus();
  await page.keyboard.type("10-1234-5678");
  await page.keyboard.press("Enter");
}

for (const width of [390, 1280]) {
  test(`at ${width}px a guest links and unlinks iMessage updates by keyboard`, async ({ db, page }) => {
    await page.setViewportSize({ height: 800, width });
    const request = await agreedRequest(db);
    await page.goto(`/booking/${request.bookingId}`);

    // The first visit compiles the page under next dev, slow while other suites run.
    await expect(page.getByRole("button", { exact: true, name: "Get updates in iMessage" })).toBeVisible({ timeout: 20_000 });
    await pressByKeyboard(page, "Get updates in iMessage");

    await entersNumber(page);

    // A desktop browser opens nothing: the number, the message and a QR code.
    const card = page.locator('[data-guest-card="imessage-link"]');
    await expect(card.getByRole("heading", { name: "Get updates in iMessage" })).toBeVisible();
    await expect(card.getByText(LINE)).toBeVisible({ timeout: 20_000 });
    const message = (await card.locator("[data-imessage-link-message]").textContent())!.trim();
    expect(message).toMatch(/^Get Find Me a Time updates: FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);
    await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // The message arrives: the card shows the masked sender, and nothing is bound yet.
    const sender = newSender();
    await guestSends(db, sender, message);
    await expect(page.getByRole("heading", { name: "Is this your iMessage?" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(sender)).toBeVisible();
    expect(await db`select 1 from app.requester_imessage_bindings where request_id = ${request.requestId}`).toHaveLength(0);

    await pressByKeyboard(page, "Confirm and link");
    await expect(page.locator('[data-imessage-link="linked"]')).toContainText(`updates go to ${sender}`);
    const [binding] = await db<{ state: string }[]>`select state from app.requester_imessage_bindings where request_id = ${request.requestId}`;
    expect(binding!.state).toBe("active");

    await pressByKeyboard(page, "Unlink iMessage");
    await expect(page.getByRole("button", { exact: true, name: "Get updates in iMessage" })).toBeVisible();
    const [ended] = await db<{ state: string }[]>`select state from app.requester_imessage_bindings where request_id = ${request.requestId}`;
    expect(ended!.state).toBe("unlinked");
  });
}

// A Mac also gets **Open Messages on this Mac** with the iOS form of the deep
// link, beside the QR code and Copy, as on the host's link screens (D17);
// pressing **Get updates in iMessage** and sending the number still opens
// nothing by itself.
test.describe("on a Mac", () => {
  test.use({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    viewport: { height: 800, width: 1280 },
  });

  test("the waiting card offers Open Messages on this Mac with the exact message", async ({ db, page }) => {
    const request = await agreedRequest(db);
    await page.goto(`/booking/${request.bookingId}`);
    await expect(page.getByRole("button", { exact: true, name: "Get updates in iMessage" })).toBeVisible({ timeout: 20_000 });
    await pressByKeyboard(page, "Get updates in iMessage");
    await entersNumber(page);

    const card = page.locator('[data-guest-card="imessage-link"]');
    await expect(card.getByRole("heading", { name: "Get updates in iMessage" })).toBeVisible();
    await expect(card.getByText(LINE)).toBeVisible({ timeout: 20_000 });
    const message = (await card.locator("[data-imessage-link-message]").textContent())!.trim();
    await expect(card.getByRole("link", { name: "Open Messages on this Mac" })).toHaveAttribute("href", `sms:${LINE}&body=${encodeURIComponent(message)}`);
    await expect(card.getByRole("link", { exact: true, name: "Open Messages" })).toHaveCount(0);
    await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/booking/${request.bookingId}`);
  });
});

// **Get updates in WhatsApp** (guest-whatsapp-link design 2): the number first,
// then on a computer the WhatsApp number, the message, a QR code and **Open
// WhatsApp** with the wa.me link; the guest's WhatsApp message shows the sender,
// and **Confirm and link** binds it on WhatsApp, with no contact card.
test("at 1280px a guest links and unlinks WhatsApp updates", async ({ db, page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  const request = await agreedRequest(db);
  await page.goto(`/booking/${request.bookingId}`);

  await expect(page.getByRole("button", { exact: true, name: "Get updates in WhatsApp" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { exact: true, name: "Get updates in iMessage" })).toBeVisible();
  await pressByKeyboard(page, "Get updates in WhatsApp");
  await entersNumber(page);

  const card = page.locator('[data-guest-card="imessage-link"]');
  await expect(card.getByRole("heading", { name: "Get updates in WhatsApp" })).toBeVisible();
  await expect(card.getByText(`+${WHATSAPP}`)).toBeVisible({ timeout: 20_000 });
  const message = (await card.locator("[data-imessage-link-message]").textContent())!.trim();
  expect(message).toMatch(/^Get Find Me a Time updates: FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);
  await expect(card.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`);
  await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();

  const sender = newWhatsAppSender();
  await guestSends(db, sender, message, "whatsapp");
  await expect(page.getByRole("heading", { name: "Is this your WhatsApp?" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(`+${sender}`)).toBeVisible();

  await pressByKeyboard(page, "Confirm and link");
  await expect(page.locator('[data-imessage-link="linked"]')).toContainText(`updates go to +${sender}`);
  await expect(page.getByRole("button", { name: "Add to contacts" })).toHaveCount(0);
  const [binding] = await db<{ channel: string; state: string }[]>`select channel, state from app.requester_imessage_bindings where request_id = ${request.requestId}`;
  expect(binding).toEqual({ channel: "whatsapp", state: "active" });

  await pressByKeyboard(page, "Unlink WhatsApp");
  await expect(page.getByRole("button", { exact: true, name: "Get updates in WhatsApp" })).toBeVisible();
});

// **Get updates in Telegram** (guest-telegram-link design 2): no number, then on
// a computer the bot, the code, a QR code and **Open Telegram** with the telegram.me
// start link; the guest's Start shows their Telegram name with where Telegram
// keeps the chat, and **Confirm and link** binds it on Telegram, with no
// contact card.
const BOT = "findmeatime_e2e_bot";

test("at 1280px a guest links and unlinks Telegram updates by keyboard", async ({ db, page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  const request = await agreedRequest(db);
  await page.goto(`/booking/${request.bookingId}`);

  await expect(page.getByRole("button", { exact: true, name: "Get updates in Telegram" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { exact: true, name: "Email updates only" })).toBeVisible();
  await pressByKeyboard(page, "Get updates in Telegram");

  // No number: the code is made at once.
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toHaveCount(0);
  const card = page.locator('[data-guest-card="imessage-link"]');
  await expect(card.getByRole("heading", { name: "Get updates in Telegram" })).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(`@${BOT}`)).toBeVisible();
  const code = (await card.locator("[data-imessage-link-message]").textContent())!.trim();
  expect(code).toMatch(/^FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);
  await expect(card.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", `https://telegram.me/${BOT}?start=${code}`);
  await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/booking/${request.bookingId}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const userId = newTelegramUser();
  await guestStartsBot(db, userId, code);
  await expect(page.getByRole("heading", { name: "Is this your Telegram?" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Grace (@grace)")).toBeVisible();
  await expect(page.getByText("Telegram keeps bot chats on its servers. Find Me a Time sends your request updates here.")).toBeVisible();
  expect(await db`select 1 from app.requester_imessage_bindings where request_id = ${request.requestId}`).toHaveLength(0);

  await pressByKeyboard(page, "Confirm and link");
  await expect(page.locator('[data-imessage-link="linked"]')).toContainText("Telegram linked: updates go to Grace (@grace)");
  await expect(page.getByRole("button", { name: "Add to contacts" })).toHaveCount(0);
  const [binding] = await db<{ channel: string; state: string }[]>`select channel, state from app.requester_imessage_bindings where request_id = ${request.requestId}`;
  expect(binding).toEqual({ channel: "telegram", state: "active" });

  await pressByKeyboard(page, "Unlink Telegram");
  await expect(page.getByRole("button", { exact: true, name: "Get updates in Telegram" })).toBeVisible();
  const [ended] = await db<{ state: string }[]>`select state from app.requester_imessage_bindings where request_id = ${request.requestId}`;
  expect(ended!.state).toBe("unlinked");
});

// On a phone, **Get updates in Telegram** opens the bot's start link at once.
test.describe("on an Android phone", () => {
  test.use({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    viewport: { height: 800, width: 390 },
  });

  test("Get updates in Telegram opens the bot's start link", async ({ db, page }) => {
    const request = await agreedRequest(db);
    // Telegram's link is caught here, so the test never leaves for telegram.me.
    let opened: string | null = null;
    await page.route("https://telegram.me/**", async (route) => {
      opened = route.request().url();
      await route.fulfill({ body: "", status: 204 });
    });
    await page.goto(`/booking/${request.bookingId}`);
    await expect(page.getByRole("button", { exact: true, name: "Get updates in Telegram" })).toBeVisible({ timeout: 20_000 });
    await pressByKeyboard(page, "Get updates in Telegram");
    await expect.poll(() => opened, { timeout: 20_000 }).toMatch(new RegExp(`^https://telegram\\.me/${BOT}\\?start=FMAT-[0-9A-HJKMNP-TV-Z]{10}$`));
    const [attempt] = await db<{ channel: string }[]>`select channel from app.imessage_links where request_id = ${request.requestId} and state = 'pending'`;
    expect(attempt).toEqual({ channel: "telegram" });
  });
});
