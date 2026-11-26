import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import type { Database } from "../../lib/server/database";
import { bindingContext } from "../../lib/server/imessage-links";
import { createImessageReceiptHandler } from "../../lib/server/imessage-receipts";
import { receiveKakaoTalkWebhook } from "../../lib/server/kakaotalk-receiver";
import { photonConfig } from "../../lib/server/photon";
import { channelHash, IMESSAGE_RECEIPT_JOB } from "../../lib/server/photon-receiver";
import { parseTokenKey, sealToken } from "../../lib/server/token-encryption";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { unreachableSetup } from "../integration/support/imessage";
import { kakaotalkRelay, newKakaoTalkRoom, RELAY_INBOUND_SECRET, TEST_KAKAOTALK_ID } from "../integration/support/kakaotalk-relay";
import { newSender } from "../integration/support/photon";
import { runJob } from "../integration/support/requests";
import { openMessagingCard } from "./support/connected-apps";
import { expect, signedInHost, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

// Linking KakaoTalk from the browser (host-kakaotalk-channel design 6, task 3.2), against the real web and
// agent services, the local stack and the relay stand-in. KakaoTalk is configured for the browser tests
// (KAKAOTALK_ACCOUNT_ID), so every device keeps its default and gets Use KakaoTalk instead beside it; the app
// question never lists it. The KakaoTalk card says first that the chat passes through Kakao and the relay phone
// and, for a host linked elsewhere, that linking ends that link; then it shows Thyme's KakaoTalk ID and the code
// with Copy code. The host's code is driven through the real webhook, signed as the relay app signs, and the
// receipt job: it links on arrival and the card moves to Linked by itself. "Without KakaoTalk" hides the ID from
// the statuses the browser reads, since the web service's configuration is fixed per run.

const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);
const PRIVACY = "Your KakaoTalk chat with Thyme passes through Kakao and our relay phone, which keeps the chat history.";
const CODE = /^FMAT-[0-9A-HJKMNP-TV-Z]{10}$/;
const config = { ...photonConfig({}), apiUrl: `http://127.0.0.1:${process.env.FAKE_PHOTON_PORT ?? "3106"}`, lineNumber: "+15550001111" };
const runtime: ConversationRuntime = {
  createSession: async () => "unused",
  readEvents: () => (async function* () {})(),
  readRecordedEvents: () => (async function* () {})(),
  sendMessage: async () => undefined,
};

const AGENTS = {
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

// The host sends the code in a new 1:1 chat with Thyme's account: the relay app's event through the webhook,
// sealed under the web service's key, then the receipt job.
async function hostSendsCode(db: Database, code: string, senderName: string) {
  const relay = kakaotalkRelay(db);
  const event = relay.message(newKakaoTalkRoom(), code, { senderName });
  const response = await receiveKakaoTalkWebhook(relay.signed("/kakaotalk/webhook", JSON.stringify(event), RELAY_INBOUND_SECRET), () => ({
    ...relay.deps(),
    tokenKey,
    tokenKeys: [tokenKey],
  }));
  expect(response.status).toBe(200);
  const [receipt] = await db<{ id: string }[]>`select id from app.imessage_receipts where message_id = ${`kakaotalk:${event.eventId}`}`;
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

// The statuses the browser reads, as a deployment without KAKAOTALK_ACCOUNT_ID answers them: no kakaotalk key.
async function withoutKakaoTalk(page: Page) {
  const strip = async (route: Route) => {
    try {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown> & { status?: Record<string, unknown> };
      const hide = (status: Record<string, unknown> | undefined) =>
        status && typeof status.channels === "object" ? { ...status, channels: { ...(status.channels as object), kakaotalk: undefined } } : status;
      await route.fulfill({ json: "state" in body ? hide(body) : { ...body, status: hide(body.status) }, response });
    } catch {
      // The page moved on while the answer was in flight.
    }
  };
  await page.route("**/api/host/imessage", strip);
  await page.route("**/api/host/imessage/commands", strip);
}

test.describe("on Android", () => {
  test.use({ userAgent: AGENTS.android, viewport: { height: 915, width: 412 } });

  test("the card keeps WhatsApp first, Use KakaoTalk instead shows the privacy sentence, ID and code, and the code links", async ({
    baseURL,
    context,
    db,
    page,
  }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL!).origin });
    const host = await signedInHost(db, context, baseURL!);
    const card = await openMessagingCard(page);

    // The device default stays: WhatsApp asks for its number, with the switches beside it.
    await expect(card.getByRole("heading", { name: "Use Find Me a Time from WhatsApp" })).toBeVisible({ timeout: 45_000 });
    await expect(card.getByRole("button", { name: "Use Telegram instead" })).toBeVisible();
    await card.getByRole("button", { name: "Use KakaoTalk instead" }).click();

    await expect(card.getByRole("heading", { name: "Use Find Me a Time from KakaoTalk" })).toBeVisible();
    await card.getByRole("button", { name: "Connect KakaoTalk" }).click();

    await expect(card.getByRole("heading", { name: "Send Thyme your code on KakaoTalk" })).toBeVisible({ timeout: 45_000 });
    // Nothing navigated: KakaoTalk has no link that writes the message.
    expect(new URL(page.url()).pathname).toBe("/app");
    const code = (await card.getByTestId("imessage-link-message").textContent())!.trim();
    expect(code).toMatch(CODE);
    await expect(card.getByTestId("kakaotalk-id")).toHaveText(TEST_KAKAOTALK_ID);
    await expect(card.getByText(PRIVACY)).toBeVisible();
    // The privacy sentence comes before the code, and nothing names a link this host does not have.
    const order = await card.evaluate((element, privacy) => {
      const text = element.textContent ?? "";
      return { code: text.indexOf("FMAT-"), privacy: text.indexOf(privacy) };
    }, PRIVACY);
    expect(order.privacy).toBeGreaterThanOrEqual(0);
    expect(order.privacy).toBeLessThan(order.code);
    await expect(card.getByText(/^Linking KakaoTalk ends/)).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Use WhatsApp instead" })).toBeVisible();

    await card.getByRole("button", { name: "Copy the link code" }).click();
    await expect(card.getByRole("button", { name: "Copy the link code" })).toContainText("Copy code");
    await expect(card.getByText("Copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await card.getByRole("button", { name: "Copy the KakaoTalk ID" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TEST_KAKAOTALK_ID);

    await page.screenshot({ path: "output/kakaotalk-card.png" });

    await hostSendsCode(db, code, "박도현");
    await expect(card.getByRole("heading", { name: "KakaoTalk is linked" })).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("박도현");
    await expect(card.getByRole("button", { name: "Not my KakaoTalk — unlink" })).toBeVisible();
    expect(await activeChannel(db, host.hostAccountId)).toEqual([{ channel: "kakaotalk" }]);
  });

  test("the /app link step offers Use KakaoTalk instead beside Telegram, and moves to Linked by itself", async ({ baseURL, context, db, page }) => {
    test.setTimeout(120_000);
    const host = await signedInHost(db, context, baseURL!, { imessageStep: true });
    await page.goto("/app");

    await expect(page.getByRole("heading", { level: 1, name: "Connect a messaging app" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { exact: true, name: "KakaoTalk" })).toHaveCount(0);
    await page.getByRole("button", { exact: true, name: "Telegram" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your Telegram" })).toBeVisible({ timeout: 45_000 });
    await page.getByRole("button", { name: "Use KakaoTalk instead" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your KakaoTalk" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(PRIVACY)).toBeVisible();
    await expect(page.getByTestId("kakaotalk-id")).toHaveText(TEST_KAKAOTALK_ID);
    await expect(page.getByRole("button", { name: "Copy code" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy ID" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use Telegram instead" })).toBeVisible();
    const code = (await page.getByTestId("imessage-link-message").textContent())!.trim();
    expect(code).toMatch(CODE);

    await hostSendsCode(db, code, "Dohyeon");
    await expect(page.getByRole("heading", { name: "Your KakaoTalk is linked." })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Dohyeon", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Not my KakaoTalk — unlink" })).toBeVisible();
    expect(await activeChannel(db, host.hostAccountId)).toEqual([{ channel: "kakaotalk" }]);
  });

  test("without KakaoTalk, neither the card nor the link step offers it", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!, { imessageStep: true });
    await withoutKakaoTalk(page);
    await page.goto("/app");
    await page.getByRole("button", { exact: true, name: "Telegram" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connect Thyme to your Telegram" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Use WhatsApp instead" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use KakaoTalk instead" })).toHaveCount(0);
    await expect(page.getByText(/KakaoTalk/)).toHaveCount(0);
  });

  test("without KakaoTalk, the card offers only the device's channels", async ({ baseURL, context, db, page }) => {
    await signedInHost(db, context, baseURL!);
    await withoutKakaoTalk(page);
    const card = await openMessagingCard(page);
    await expect(card.getByRole("heading", { name: "Use Find Me a Time from WhatsApp" })).toBeVisible({ timeout: 45_000 });
    await expect(card.getByRole("button", { name: "Use Telegram instead" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Use KakaoTalk instead" })).toHaveCount(0);
  });
});

test.describe("on a Windows computer", () => {
  test.use({ userAgent: AGENTS.windows, viewport: { height: 900, width: 1280 } });

  test("the card says linking KakaoTalk ends the iMessage link, and the code moves the link to KakaoTalk", async ({ baseURL, context, db, page }) => {
    test.setTimeout(120_000);
    const host = await signedInHost(db, context, baseURL!);
    // The host is linked on iMessage already.
    const bindingId = randomUUID();
    const sender = newSender();
    await db`
      insert into app.imessage_bindings (id, channel, host_account_id, sender_hash, sender_ciphertext, sealed_key_id)
      values (${bindingId}, 'imessage', ${host.hostAccountId}, ${channelHash(tokenKey, "imessage", "sender", sender)},
              ${sealToken(tokenKey, sender, bindingContext(bindingId)).ciphertext}, ${tokenKey.id})
    `;
    // A KakaoTalk attempt made from this browser, as Connect KakaoTalk makes one; it takes no number.
    const created = await page.request.post("/api/host/imessage/commands", {
      data: { input: { channel: "kakaotalk" }, operation: "imessage.link.create", retryKey: randomUUID() },
      headers: { origin: new URL(baseURL!).origin },
    });
    expect(created.status()).toBe(201);

    const card = await openMessagingCard(page);
    await expect(card.getByRole("heading", { name: "Send Thyme your code on KakaoTalk" })).toBeVisible({ timeout: 45_000 });
    await expect(card.getByText(PRIVACY)).toBeVisible();
    await expect(card.getByText("Linking KakaoTalk ends your iMessage link.")).toBeVisible();
    const code = (await card.getByTestId("imessage-link-message").textContent())!.trim();
    expect(code).toMatch(CODE);

    await hostSendsCode(db, code, "Test Host");
    await expect(card.getByRole("heading", { name: "KakaoTalk is linked" })).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("Test Host");
    expect(await activeChannel(db, host.hostAccountId)).toEqual([{ channel: "kakaotalk" }]);
  });
});
