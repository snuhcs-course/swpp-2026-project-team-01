import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { Database } from "../../lib/server/database";
import { bindingContext } from "../../lib/server/imessage-links";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { photonConfig } from "../../lib/server/photon";
import { channelHash, IMESSAGE_RECEIPT_JOB } from "../../lib/server/photon-receiver";
import { receiveTelegramWebhook } from "../../lib/server/telegram-receiver";
import { parseTokenKey, sealToken } from "../../lib/server/token-encryption";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { unreachableSetup } from "../integration/support/imessage";
import { newSender } from "../integration/support/photon";
import { runJob } from "../integration/support/requests";
import { newTelegramUser, telegramDelivery, telegramMessage, TEST_TELEGRAM_SECRET } from "../integration/support/telegram";
import { expect, signedInHost, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

// Linking Telegram from the browser (host-telegram-channel design 3, 5, 6 and 11; D5 to D7, D13; task 3.2),
// against the real web and agent services, the local stack and the stand-ins. Telegram is offered on every
// device: Android gets WhatsApp with Use Telegram instead, or Telegram when WhatsApp is not configured; an
// iPhone gets iMessage with Use Telegram instead (and Use WhatsApp instead); another computer asks among the
// configured channels. The host's /start is driven through the real Telegram webhook and the receipt job;
// Confirm and link, after the Telegram name and the privacy sentence, binds it. "Without WhatsApp" hides the
// WhatsApp number from the statuses the browser reads, since the web service's configuration is fixed per run.

const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);
const BOT = "findmeatime_e2e_bot";
const PHOTON = `http://127.0.0.1:${process.env.FAKE_PHOTON_PORT ?? "3106"}`;
const config = { ...photonConfig({}), apiUrl: PHOTON, lineNumber: "+15550001111", whatsappNumber: "15550002222" };
const runtime: ConversationRuntime = {
  createSession: async () => "unused",
  readEvents: () => (async function* () {})(),
  readRecordedEvents: () => (async function* () {})(),
  sendMessage: async () => undefined,
};
const PRIVACY = "Telegram keeps bot chats on its servers. Find Me a Time sends your request summaries here.";
const CODE = /^FMAT-[0-9A-HJKMNP-TV-Z]{10}$/;
const startLink = (code: string) => `https://t.me/${BOT}?start=${code}`;

const AGENTS = {
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

// The host taps Start in Telegram: /start <code> through the webhook, then the receipt job.
async function hostStartsBot(db: Database, userId: number, code: string) {
  const body = telegramMessage({ firstName: "Dohyeon", text: `/start ${code}`, userId, username: "dohyeon" });
  const response = await receiveTelegramWebhook(telegramDelivery(body), () => ({ config: { secret: TEST_TELEGRAM_SECRET }, db, tokenKey }));
  expect(response.status).toBe(200);
  const messageId = `update:${(JSON.parse(body) as { update_id: number }).update_id}`;
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${messageId} and channel = 'telegram'`;
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

async function activeChannel(db: Database, hostAccountId: string) {
  return db<{ channel: string }[]>`select channel from app.imessage_bindings where host_account_id = ${hostAccountId} and state = 'active'`;
}

// The statuses the browser reads, as a deployment without a WhatsApp number answers them.
async function withoutWhatsApp(page: Page) {
  const strip = async (route: Route) => {
    try {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown> & { status?: Record<string, unknown> };
      const hide = (status: Record<string, unknown> | undefined) =>
        status && typeof status.channels === "object" ? { ...status, channels: { ...(status.channels as object), whatsapp: null } } : status;
      await route.fulfill({ json: "state" in body ? hide(body) : { ...body, status: hide(body.status) }, response });
    } catch {
      // The page moved on (to t.me) while the answer was in flight.
    }
  };
  await page.route("**/api/host/imessage", strip);
  await page.route("**/api/host/imessage/commands", strip);
}

async function openCard(page: Page) {
  await page.goto("/app");
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeEnabled({ timeout: 45_000 });
  await menu.click();
  await page.getByRole("menuitem", { name: "iMessage" }).click();
  const card = page.locator("[data-imessage-card]");
  await expect(card).toBeVisible({ timeout: 15_000 });
  return card;
}

test.describe("on Android", () => {
  test.use({ userAgent: AGENTS.android, viewport: { height: 915, width: 412 } });

  test("with WhatsApp, Use Telegram instead makes a Telegram code, and the host's Start links it on Confirm and link", async ({
    baseURL,
    context,
    db,
    page,
  }) => {
    test.setTimeout(120_000);
    const host = await signedInHost(db, context, baseURL!, { imessageStep: true });
    await page.goto("/app");

    // WhatsApp asks for the number first (guest-whatsapp-link D3); Telegram needs none.
    await expect(page.getByRole("heading", { level: 1, name: "Which number do you use for WhatsApp?" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Use iMessage instead" })).toHaveCount(0);
    await page.getByRole("button", { name: "Use Telegram instead" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your Telegram" })).toBeVisible({ timeout: 45_000 });
    const preview = (await page.getByTestId("imessage-link-message").textContent())!.trim();
    const code = preview.replace(/^\/start /, "");
    expect(code).toMatch(CODE);
    await expect(page.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", startLink(code));
    await expect(page.getByText(`Thyme · @${BOT}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Use WhatsApp instead" })).toBeVisible();

    await hostStartsBot(db, newTelegramUser(), code);
    await expect(page.getByRole("heading", { name: "Is this you?" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Dohyeon (@dohyeon)")).toBeVisible();
    await expect(page.getByText(PRIVACY)).toBeVisible();
    expect(await activeChannel(db, host.hostAccountId)).toHaveLength(0);

    await page.getByRole("button", { name: "Confirm and link" }).click();
    await expect(page.getByRole("heading", { name: "Your Telegram is connected." })).toBeVisible();
    expect(await activeChannel(db, host.hostAccountId)).toEqual([{ channel: "telegram" }]);

    await page.getByRole("button", { name: "Go to Home" }).click();
    const card = await openCard(page);
    await expect(card.getByRole("heading", { name: "Telegram is linked" })).toBeVisible();
    await expect(card).toContainText("Linked on Telegram Dohyeon (@dohyeon)");
    await expect(card.getByRole("button", { name: "Add to contacts" })).toHaveCount(0);
  });

  test("without WhatsApp, the link step goes straight to Telegram", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await withoutWhatsApp(page);
    await page.goto("/app");

    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your Telegram" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: /instead/ })).toHaveCount(0);
    const code = (await page.getByTestId("imessage-link-message").textContent())!.trim().replace(/^\/start /, "");
    await expect(page.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", startLink(code));
  });

  test("without WhatsApp, the card's Connect Telegram makes a code, then opens the bot's start link", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!);
    await withoutWhatsApp(page);
    // Nothing reaches Telegram: the stand-in page records where the card went.
    await page.route("https://t.me/**", (route) => route.fulfill({ body: "Telegram", contentType: "text/plain" }));
    const card = await openCard(page);
    await expect(card.getByRole("heading", { name: "Use Find Me a Time from Telegram" })).toBeVisible({ timeout: 45_000 });
    await expect(card.getByRole("button", { name: /instead/ })).toHaveCount(0);
    await card.getByRole("button", { name: "Connect Telegram" }).click();
    await page.waitForURL(/^https:\/\/t\.me\//, { timeout: 45_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/${BOT}`);
    expect(url.searchParams.get("start")).toMatch(CODE);
  });
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: AGENTS.iphone, viewport: { height: 844, width: 390 } });

  test("iMessage comes first with Use Telegram instead, and Use WhatsApp instead only where WhatsApp is configured", async ({
    baseURL,
    context,
    db,
    page,
  }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: "Which number do you use for iMessage?" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Use WhatsApp instead" })).toBeVisible();

    await page.getByRole("button", { name: "Use Telegram instead" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your Telegram" })).toBeVisible({ timeout: 45_000 });
    const code = (await page.getByTestId("imessage-link-message").textContent())!.trim().replace(/^\/start /, "");
    await expect(page.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", startLink(code));
    await expect(page.getByRole("button", { name: "Use iMessage instead" })).toBeVisible();
  });

  test("without WhatsApp, the only switch is Use Telegram instead", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await withoutWhatsApp(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: "Which number do you use for iMessage?" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Use Telegram instead" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use WhatsApp instead" })).toHaveCount(0);
  });
});

test.describe("on a Windows computer", () => {
  test.use({ userAgent: AGENTS.windows, viewport: { height: 900, width: 1280 } });

  test("the link step asks among the configured apps, then shows Telegram's link, QR code and Copy", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await page.goto("/app");

    await expect(page.getByRole("heading", { level: 1, name: "Which app do you use on your phone?" })).toBeVisible({ timeout: 45_000 });
    for (const name of ["iMessage", "WhatsApp", "Telegram"]) await expect(page.getByRole("button", { exact: true, name })).toBeVisible();
    await page.getByRole("button", { exact: true, name: "Telegram" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your Telegram" })).toBeVisible({ timeout: 45_000 });
    const code = (await page.getByTestId("imessage-link-message").textContent())!.trim().replace(/^\/start /, "");
    expect(code).toMatch(CODE);
    await expect(page.getByTestId("imessage-qr").locator("svg")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", startLink(code));
    await expect(page.getByText(startLink(code), { exact: true })).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
  });

  test("without WhatsApp, the question lists iMessage and Telegram only", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await withoutWhatsApp(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: "Which app do you use on your phone?" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { exact: true, name: "Telegram" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "iMessage" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "WhatsApp" })).toHaveCount(0);
  });

  test("the card shows Telegram's code with QR and Copy, names the iMessage link it replaces and the privacy sentence", async ({
    baseURL,
    context,
    db,
    page,
  }) => {
    const host = await signedInHost(db, context, baseURL!);
    // The host is linked on iMessage already.
    const bindingId = randomUUID();
    const sender = newSender();
    await db`
      insert into app.imessage_bindings (id, channel, host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
      values (${bindingId}, 'imessage', ${host.hostAccountId}, ${channelHash(tokenKey, "imessage", "sender", sender)},
              ${sealToken(tokenKey, sender, bindingContext(bindingId)).ciphertext}, ${tokenKey.id})
    `;
    // A Telegram attempt made from this browser, as Connect Telegram makes one.
    const created = await page.request.post("/api/host/imessage/commands", {
      data: { input: { channel: "telegram" }, operation: "imessage.link.create", retryKey: randomUUID() },
      headers: { origin: new URL(baseURL!).origin },
    });
    expect(created.status()).toBe(201);

    const card = await openCard(page);
    await expect(card.getByRole("heading", { name: "Start Thyme's bot in Telegram" })).toBeVisible({ timeout: 45_000 });
    const code = (await card.getByTestId("imessage-link-message").textContent())!.trim();
    expect(code).toMatch(CODE);
    await expect(card).toContainText(`@${BOT}`);
    await expect(card.getByTestId("imessage-qr").locator("svg")).toBeVisible();
    await expect(card.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", startLink(code));
    await expect(card.getByRole("button", { name: "Copy the Telegram link" })).toBeVisible();

    await hostStartsBot(db, newTelegramUser(), code);
    await expect(card.getByRole("heading", { name: "Is this you?" })).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("Dohyeon (@dohyeon)");
    await expect(card.getByText("This replaces your iMessage link.")).toBeVisible();
    await expect(card.getByText(PRIVACY)).toBeVisible();
    await card.getByRole("button", { name: "Confirm and link" }).click();
    await expect(card.getByRole("heading", { name: "Telegram is linked" })).toBeVisible({ timeout: 10_000 });
    expect(await activeChannel(db, host.hostAccountId)).toEqual([{ channel: "telegram" }]);
  });

  test("/?flow=telegram starts from Telegram before sign-in, and the Start asks for Google", async ({ db, page }) => {
    await page.goto("/?flow=telegram");

    await page.getByRole("button", { name: "Onboard with Telegram" }).click();
    const popup = page.getByRole("dialog", { name: "Start Thyme's bot in Telegram" });
    await expect(popup).toBeVisible({ timeout: 45_000 });
    const code = (await popup.getByTestId("imessage-link-message").textContent())!.trim().replace(/^\/start /, "");
    expect(code).toMatch(CODE);
    await expect(popup.getByText(`Thyme · @${BOT}`)).toBeVisible();
    await expect(popup.getByRole("link", { name: "Open Telegram" })).toHaveAttribute("href", startLink(code));
    await expect(popup.getByTestId("imessage-qr").locator("svg")).toBeVisible();

    await hostStartsBot(db, newTelegramUser(), code);
    await expect(page.getByRole("heading", { name: "Got your message." })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Dohyeon (@dohyeon)")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/auth/sign-in");
  });
});
