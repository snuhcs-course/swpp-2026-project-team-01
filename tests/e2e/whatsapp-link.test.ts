import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Database } from "../../lib/server/database";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { photonConfig } from "../../lib/server/photon";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { parseTokenKey } from "../../lib/server/token-encryption";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { newWhatsAppSender, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET, whatsAppEvent } from "../integration/support/photon";
import { unreachableSetup } from "../integration/support/imessage";
import { runJob } from "../integration/support/requests";
import { expect, signedInHost, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

// Linking WhatsApp from the browser (host-whatsapp-channel design 5, 6 and 8; D5 to D7, D12; task 3.2),
// against the real web and agent services, the local stack and the Photon stand-in. The channel follows the
// device: Android gets WhatsApp only, an iPhone gets iMessage with Use WhatsApp instead, and another computer
// first asks which app the host uses. The host's WhatsApp message is driven through the real receiver and the
// receipt job as a WhatsApp Business event; Confirm and link, after the opt-in sentence, binds it.

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
const OPT_IN = "Thyme will message you on WhatsApp about your requests. If you have not written for a day, it sends a short notice instead.";
const MESSAGE = /^Link my Find Me a Time account: FMAT-[0-9A-HJKMNP-TV-Z]{10}$/;

const AGENTS = {
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

const waLink = (message: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(message)}`;

// The host's WhatsApp message, signed to the receiver and processed by the receipt job.
async function hostSendsOnWhatsApp(db: Database, sender: string, text: string) {
  const id = `wamid.${randomUUID()}`;
  const response = await receivePhotonWebhook(signedWebhook(whatsAppEvent({ id, sender, text })), () => ({
    config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID },
    db,
    tokenKey,
  }));
  expect(response.status).toBe(200);
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`;
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

  test("the link step offers WhatsApp only, and the host's WhatsApp message links it on Confirm and link", async ({ baseURL, context, db, page }) => {
    const host = await signedInHost(db, context, baseURL!, { imessageStep: true });
    await page.goto("/app");

    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your WhatsApp" })).toBeVisible({ timeout: 45_000 });
    const message = (await page.getByTestId("imessage-link-message").textContent())!.trim();
    expect(message).toMatch(MESSAGE);
    await expect(page.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", waLink(message));
    await expect(page.getByText(`Thyme · +${WHATSAPP}`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Messages" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /instead/ })).toHaveCount(0);

    const sender = newWhatsAppSender();
    await hostSendsOnWhatsApp(db, sender, message);
    await expect(page.getByRole("heading", { name: "Is this you?" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`•••• ${sender.slice(-4)}`)).toBeVisible();
    await expect(page.getByText(OPT_IN)).toBeVisible();
    expect(await activeChannel(db, host.hostAccountId)).toHaveLength(0);

    await page.getByRole("button", { name: "Confirm and link" }).click();
    await expect(page.getByRole("heading", { name: "Your WhatsApp is connected." })).toBeVisible();
    expect(await activeChannel(db, host.hostAccountId)).toEqual([{ channel: "whatsapp" }]);

    // The in-chat card names the channel and offers no Add to contacts.
    await page.getByRole("button", { name: "Go to Home" }).click();
    const card = await openCard(page);
    await card.getByRole("button", { name: `WhatsApp linked •••• ${sender.slice(-4)}` }).click();
    await expect(card.getByRole("heading", { name: "WhatsApp is linked" })).toBeVisible();
    await expect(card).toContainText(`Linked on WhatsApp •••• ${sender.slice(-4)}`);
    await expect(card.getByRole("button", { name: "Add to contacts" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Unlink WhatsApp" })).toBeVisible();
  });

  test("the card's Connect WhatsApp makes the code, then opens wa.me with the message", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!);
    // Nothing reaches WhatsApp: the stand-in page records where the card went.
    await page.route("https://wa.me/**", (route) => route.fulfill({ body: "WhatsApp", contentType: "text/plain" }));
    const card = await openCard(page);

    await expect(card.getByRole("heading", { name: "Use Find Me a Time from WhatsApp" })).toBeVisible({ timeout: 45_000 });
    await expect(card.getByRole("button", { name: "Connect iMessage" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /instead/ })).toHaveCount(0);
    await card.getByRole("button", { name: "Connect WhatsApp" }).click();
    await page.waitForURL(/^https:\/\/wa\.me\//, { timeout: 45_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/${WHATSAPP}`);
    expect(url.searchParams.get("text")).toMatch(MESSAGE);
  });
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: AGENTS.iphone, viewport: { height: 844, width: 390 } });

  test("Use WhatsApp instead switches the link step to a WhatsApp code", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await page.goto("/app");

    // iMessage asks for the number first (imessage-number-registration D1); WhatsApp needs none.
    await expect(page.getByRole("heading", { level: 1, name: "Which number do you use for iMessage?" })).toBeVisible({ timeout: 45_000 });

    await page.getByRole("button", { name: "Use WhatsApp instead" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your WhatsApp" })).toBeVisible({ timeout: 45_000 });
    const message = (await page.getByTestId("imessage-link-message").textContent())!.trim();
    await expect(page.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", waLink(message));
    await expect(page.getByRole("button", { name: "Use iMessage instead" })).toBeVisible();
  });
});

test.describe("on a Windows computer", () => {
  test.use({ userAgent: AGENTS.windows, viewport: { height: 900, width: 1280 } });

  test("the link step asks which app first, then shows WhatsApp's number, QR code and link", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await page.goto("/app");

    await expect(page.getByRole("heading", { level: 1, name: "Which app do you use on your phone?" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("imessage-link-message")).toHaveCount(0);
    await page.getByRole("button", { exact: true, name: "WhatsApp" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your WhatsApp" })).toBeVisible({ timeout: 45_000 });
    const message = (await page.getByTestId("imessage-link-message").textContent())!.trim();
    expect(message).toMatch(MESSAGE);
    await expect(page.getByTestId("imessage-qr").locator("svg")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", waLink(message));
    await expect(page.getByText(`+${WHATSAPP}`, { exact: true })).toBeVisible();
  });

  test("the card asks which app first, then offers that channel", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!);
    const card = await openCard(page);

    await expect(card.getByRole("heading", { name: "Which app do you use on your phone?" })).toBeVisible({ timeout: 45_000 });
    await card.getByRole("button", { exact: true, name: "WhatsApp" }).click();
    await expect(card.getByRole("heading", { name: "Use Find Me a Time from WhatsApp" })).toBeVisible();
    await card.getByRole("button", { name: "Connect WhatsApp" }).click();
    await expect(card.getByRole("heading", { name: "Send the message from your WhatsApp" })).toBeVisible({ timeout: 45_000 });
    const message = (await card.getByTestId("imessage-link-message").textContent())!.trim();
    await expect(card).toContainText(`+${WHATSAPP}`);
    await expect(card.getByTestId("imessage-qr").locator("svg")).toBeVisible();
    await expect(card.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", waLink(message));
    await expect(card.getByRole("button", { name: "Copy the link message" })).toBeVisible();
  });

  test("/?flow=whatsapp starts from WhatsApp before sign-in, and the arriving message asks for Google", async ({ db, page }) => {
    await page.goto("/?flow=whatsapp");

    await page.getByRole("button", { name: "Onboard with WhatsApp" }).click();
    const popup = page.getByRole("dialog", { name: "Send Thyme one message" });
    await expect(popup).toBeVisible({ timeout: 45_000 });
    const message = (await popup.getByTestId("imessage-link-message").textContent())!.trim();
    expect(message).toMatch(MESSAGE);
    await expect(popup.getByText(`Thyme · +${WHATSAPP}`)).toBeVisible();
    await expect(popup.getByRole("link", { name: "Open WhatsApp" })).toHaveAttribute("href", waLink(message));

    const sender = newWhatsAppSender();
    await hostSendsOnWhatsApp(db, sender, message);
    await expect(page.getByRole("heading", { name: "Got your message." })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`•••• ${sender.slice(-4)}`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/auth/sign-in");
  });
});
