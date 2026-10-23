import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Database } from "../../lib/server/database";
import { createImessageSendHandler, IMESSAGE_SEND_JOB } from "../../lib/server/imessage-outbox";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { photonConfig } from "../../lib/server/photon";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { parseTokenKey } from "../../lib/server/token-encryption";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { messagesEvent, newSender, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "../integration/support/photon";
import { runJob } from "../integration/support/requests";
import { expect, signedInHost, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

// The Connect iMessage card in /app (host-imessage-channel design 4 to 6 and 11;
// task 3.2), by keyboard at 390 and 1280 pixels, against the real web and agent
// services, the local stack and the Photon stand-in. The host's message and the
// line's sends are driven here through the real receiver and jobs, as Photon and
// the worker would: a desktop shows the number, the message, Copy and a QR code
// and opens nothing; the host's message shows the masked sender, and only
// Confirm and link binds it; unlinking returns to the start; the fallback's code
// is typed back and never shown; a phone's card carries the platform's deep link.

const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);
const LINE = "+15550001111";
const PHOTON = `http://127.0.0.1:${process.env.FAKE_PHOTON_PORT ?? "3106"}`;
const config = { ...photonConfig({}), apiUrl: PHOTON, lineNumber: LINE };
const runtime: ConversationRuntime = {
  createSession: async () => "unused",
  readEvents: () => (async function* () {})(),
  readRecordedEvents: () => (async function* () {})(),
  sendMessage: async () => undefined,
};

// The host's message, signed to the receiver and processed by the receipt job.
async function hostSends(db: Database, sender: string, text: string) {
  const id = `msg_${randomUUID()}`;
  const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ id, sender, text })), () => ({
    config: { secret: TEST_WEBHOOK_SECRET, webhookId: TEST_WEBHOOK_ID },
    db,
    tokenKey,
  }));
  expect(response.status).toBe(200);
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${id}`;
  const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_RECEIPT_JOB} and dedupe_key = ${`receipt:${receipt!.id}`}`;
  await runJob(db, job!.id, createImessageReceiptHandler(() => ({ config, db, env: {}, tokenKey, tokenKeys: [tokenKey] })));
}

// Sends the host's queued messages through the stand-in and returns their texts.
async function sendQueued(db: Database, hostAccountId: string, kind: string) {
  const rows = await db<{ id: string }[]>`
    select o.id from app.imessage_outbox o where o.host_account_id = ${hostAccountId} and o.kind = ${kind} and o.state = 'queued'
  `;
  for (const row of rows) {
    const [job] = await db<{ id: string }[]>`select id from app.jobs where kind = ${IMESSAGE_SEND_JOB} and dedupe_key = ${`outbox:${row.id}`}`;
    await runJob(
      db,
      job!.id,
      createImessageSendHandler(() => ({ config, db, env: {}, origin: "http://localhost:3100", runtime, signingKey: "s".repeat(40), tokenKeys: [tokenKey] })),
    );
  }
  const sends = (await (await fetch(`${PHOTON}/__sends`)).json()) as { content: { kind: string; text?: string }; idempotencyKey: string }[];
  const ids = new Set(rows.map((row) => row.id));
  return sends.filter((send) => ids.has(send.idempotencyKey)).map((send) => send.content.text ?? "");
}

async function openCard(page: Page) {
  await page.goto("/app");
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible({ timeout: 20_000 });
  await menu.click();
  await page.getByRole("menuitem", { name: "iMessage" }).click();
  const card = page.locator("[data-imessage-card]");
  await expect(card).toBeVisible({ timeout: 15_000 });
  return card;
}

async function press(page: Page, name: string) {
  const button = page.getByRole("button", { exact: true, name });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
}

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

for (const width of [390, 1280]) {
  test(`at ${width}px a host links iMessage by sending the code and confirming, then unlinks`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: 800, width });
    const host = await signedInHost(db, context, baseURL!);
    const card = await openCard(page);

    await expect(card.getByRole("heading", { name: "Use Find Me a Time from iMessage" })).toBeVisible();
    await press(page, "Connect iMessage");

    // A desktop browser opens nothing: the number, the message, Copy and the QR code.
    // The first command compiles its route under next dev, slow while other suites run.
    await expect(card.getByRole("heading", { name: "Send the message from your iMessage" })).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(LINE);
    const message = (await card.getByTestId("imessage-link-message").textContent())!.trim();
    expect(message).toMatch(/^Link my Find Me a Time account: FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);
    await expect(card.getByTestId("imessage-qr").locator("svg")).toBeVisible();
    await expect(card.getByRole("link", { name: "Open Messages" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Copy the link message" })).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // A reload shows the same code.
    await page.reload();
    const again = await openCard(page);
    await expect(again.getByTestId("imessage-link-message")).toHaveText(message);

    // The host sends it; the card polls and shows the masked sender.
    const sender = newSender();
    await hostSends(db, sender, message);
    await expect(again.getByRole("heading", { name: "Is this you?" })).toBeVisible({ timeout: 10_000 });
    await expect(again).toContainText(`•••• ${sender.slice(-4)}`);
    expect(await db`select 1 from app.imessage_bindings where host_account_id = ${host.hostAccountId} and state = 'active'`).toHaveLength(0);
    expect(await sendQueued(db, host.hostAccountId, "link_received")).toEqual([
      "Got it. Go back to Find Me a Time in your browser and tap Confirm and link to finish.",
    ]);

    await press(page, "Confirm and link");
    await expect(again.getByRole("heading", { name: "iMessage is linked" })).toBeVisible();
    expect(await db`select 1 from app.imessage_bindings where host_account_id = ${host.hostAccountId} and state = 'active'`).toHaveLength(1);

    await press(page, "Add to contacts");
    await expect(again).toContainText("Sending your contact card");

    await press(page, "Unlink iMessage");
    await press(page, "Unlink");
    await expect(again.getByRole("heading", { name: "Use Find Me a Time from iMessage" })).toBeVisible();
    expect(await db`select 1 from app.imessage_bindings where host_account_id = ${host.hostAccountId} and state = 'active'`).toHaveLength(0);
  });
}

test("at 390px a host links by a texted code, typed back without ever being shown", async ({ baseURL, context, db, page }) => {
  await page.setViewportSize({ height: 800, width: 390 });
  const host = await signedInHost(db, context, baseURL!);
  const card = await openCard(page);
  const number = newSender();

  await press(page, "Send me a code instead");
  await card.getByLabel("Your iPhone number, with country code").fill(number);
  await press(page, "Send code");
  await expect(card.getByRole("heading", { name: "Enter the code we texted you" })).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(`•••• ${number.slice(-4)}`);

  const [text] = await sendQueued(db, host.hostAccountId, "fallback_code");
  const code = /(\d{6})/.exec(text ?? "")![1]!;
  await page.reload();
  const again = await openCard(page);
  await expect(again).not.toContainText(code);

  await again.getByLabel("Six-digit code").fill(code);
  await press(page, "Confirm and link");
  await expect(again.getByRole("heading", { name: "iMessage is linked" })).toBeVisible();
});

test.describe("on an iPhone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    viewport: { height: 844, width: 390 },
  });

  test("the card carries the iOS deep link with the exact message and no QR code", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!);
    const card = await openCard(page);
    await press(page, "Connect iMessage");
    const link = card.getByRole("link", { name: "Open Messages" });
    await expect(link).toBeVisible({ timeout: 10_000 });
    const message = (await card.getByTestId("imessage-link-message").textContent())!.trim();
    await expect(link).toHaveAttribute("href", `sms:${LINE}&body=${encodeURIComponent(message)}`);
    await expect(card.getByTestId("imessage-qr")).toHaveCount(0);
  });
});
