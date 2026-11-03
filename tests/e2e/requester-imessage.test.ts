import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { ConversationRuntime } from "../../lib/server/conversations";
import type { Database } from "../../lib/server/database";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { photonConfig } from "../../lib/server/photon";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { unreachableSetup } from "../integration/support/imessage";
import { messagesEvent, newSender, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "../integration/support/photon";
import { runJob } from "../integration/support/requests";
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
// link** binds it; **Unlink iMessage** returns to the start.

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

// The line appears once the guest agreed, while the request waits for the
// host's approval (guest-flow-completion U10).
async function agreedRequest(db: Database) {
  const host = await readyRequestHost(db);
  return agreedReviewRequest(db, host.hostAccountId);
}

// The guest's message, signed to the receiver and processed by the receipt job.
async function guestSends(db: Database, sender: string, text: string) {
  const id = `msg_${randomUUID()}`;
  const response = await receivePhotonWebhook(signedWebhook(messagesEvent({ id, sender, text })), () => ({
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

async function pressByKeyboard(page: Page, name: string) {
  const button = page.getByRole("button", { exact: true, name });
  await button.focus();
  await expect(button).toBeFocused();
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

    // The guest's number first (imessage-number-registration D1), typed by keyboard and sent with Enter.
    const field = page.getByRole("textbox", { name: "Mobile number" });
    await expect(field).toBeVisible();
    await field.focus();
    await page.keyboard.type("10-1234-5678");
    await page.keyboard.press("Enter");

    // A desktop browser opens nothing: the number, the message and a QR code.
    const card = page.locator('[data-guest-card="imessage-link"]');
    await expect(card.getByRole("heading", { name: "Get updates in iMessage" })).toBeVisible();
    await expect(card.getByText(LINE)).toBeVisible();
    const message = (await card.locator("[data-imessage-link-message]").textContent())!.trim();
    expect(message).toMatch(/^Get Find Me a Time updates: FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);
    await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // The message arrives: the card shows the masked sender, and nothing is bound yet.
    const sender = newSender();
    await guestSends(db, sender, message);
    await expect(page.getByRole("heading", { name: "Is this your iMessage?" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`•••• ${sender.slice(-4)}`)).toBeVisible();
    expect(await db`select 1 from app.requester_imessage_bindings where request_id = ${request.requestId}`).toHaveLength(0);

    await pressByKeyboard(page, "Confirm and link");
    await expect(page.locator('[data-imessage-link="linked"]')).toContainText(`updates go to •••• ${sender.slice(-4)}`);
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
// pressing **Get updates in iMessage** still opens nothing by itself.
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

    // The guest's number comes first (imessage-number-registration D1).
    const field = page.getByRole("textbox", { name: "Mobile number" });
    await expect(field).toBeVisible();
    await field.focus();
    await page.keyboard.type("10-1234-5678");
    await page.keyboard.press("Enter");

    const card = page.locator('[data-guest-card="imessage-link"]');
    await expect(card.getByRole("heading", { name: "Get updates in iMessage" })).toBeVisible();
    await expect(card.getByText(LINE)).toBeVisible();
    const message = (await card.locator("[data-imessage-link-message]").textContent())!.trim();
    await expect(card.getByRole("link", { name: "Open Messages on this Mac" })).toHaveAttribute("href", `sms:${LINE}&body=${encodeURIComponent(message)}`);
    await expect(card.getByRole("link", { exact: true, name: "Open Messages" })).toHaveCount(0);
    await expect(card.getByRole("img", { name: /QR code/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/booking/${request.bookingId}`);
  });
});
