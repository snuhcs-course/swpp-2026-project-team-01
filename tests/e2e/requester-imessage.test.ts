import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { hashBookingId, sealBookingLink } from "../../lib/server/booking-links";
import type { ConversationRuntime } from "../../lib/server/conversations";
import type { Database } from "../../lib/server/database";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { photonConfig } from "../../lib/server/photon";
import { IMESSAGE_RECEIPT_JOB, receivePhotonWebhook } from "../../lib/server/photon-receiver";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { unreachableSetup } from "../integration/support/imessage";
import { messagesEvent, newSender, signedWebhook, TEST_WEBHOOK_ID, TEST_WEBHOOK_SECRET } from "../integration/support/photon";
import { runJob } from "../integration/support/requests";
import { readyRequestHost } from "./support/requester";
import { expect, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

// **Get updates in iMessage** on the booking page (guest-flow-completion design
// 1; task 8.4's linking part), by keyboard at 390 and 1280 pixels, against the
// real web and agent services, the local stack and the Photon stand-in. The
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

async function identifiedRequest(db: Database) {
  const host = await readyRequestHost(db);
  const bookingId = randomUUID();
  const email = `grace-${randomUUID().slice(0, 8)}@example.test`;
  const details = { language: "en", timezone: "Asia/Seoul", windows: [] };
  const [request] = await db<{ id: string }[]>`
    insert into app.requests
      (host_account_id, details, requester_name, contact_email, contact_confirmed_email, state, identified_at, expires_at)
    values (${host.hostAccountId}, ${db.json(details)}, 'Grace Hopper', ${email}, ${email}, 'gathering', now(), now() + interval '7 days')
    returning id
  `;
  const sealed = sealBookingLink(tokenKey, request!.id, bookingId);
  await db`
    insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
    values (${request!.id}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;
  await db`insert into app.discussions (principal_type, principal_id, audience) values ('requester_request', ${request!.id}, 'requester')`;
  return { bookingId, requestId: request!.id };
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
    const request = await identifiedRequest(db);
    await page.goto(`/booking/${request.bookingId}`);

    // The first visit compiles the page under next dev, slow while other suites run.
    await expect(page.getByRole("button", { exact: true, name: "Get updates in iMessage" })).toBeVisible({ timeout: 20_000 });
    await pressByKeyboard(page, "Get updates in iMessage");

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
