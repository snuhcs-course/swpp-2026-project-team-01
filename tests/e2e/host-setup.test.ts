import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { TUTORIAL_TEXT } from "../../lib/contracts/host-tutorial";
import { confirmedHost } from "./support/setup-host";
import { expect, signedInHost, test } from "./support/session";

// Host setup in /app since the host web chat was removed (remove-host-web-chat):
// setup happens only in conversation with Thyme in the linked messenger, so the
// web shows an incomplete host no setup questions and no chat, only the way
// back to the messenger, and shows a ready host the share links and the sample
// request offer. Against the real web and agent services, the local Supabase
// stack, the fake Google on port 3103 and the local model stand-in.

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

function card(page: Page, name: string | RegExp) {
  return page.getByRole("region", { name });
}

function uniqueHandle() {
  return `e2e${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

for (const width of [390, 1280]) {
  test(`at ${width}px an incomplete host is sent to the messenger, with no setup questions or chat`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: width === 1280 ? 800 : 844, width });
    await signedInHost(db, context, baseURL!);
    await page.goto("/app");

    await expect(page.getByRole("heading", { name: "Finish setup with Thyme in your messaging app" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-imessage-card]")).toBeVisible();
    await expect(page.locator("[data-setup-card]")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message Thyme" })).toHaveCount(0);
    await expect(page.getByRole("log", { name: "Messages" })).toHaveCount(0);
    expect(await hasNoHorizontalScroll(page)).toBe(true);
  });
}

test("a ready host sees the share links without a chat", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  const handle = uniqueHandle();
  await confirmedHost(db, host.hostAccountId, { displayName: "E2E Host", handle }, baseURL!);
  await page.goto("/app?view=setup");

  const links = card(page, "You're ready.");
  await expect(links).toBeVisible({ timeout: 15_000 });
  await expect(links.getByText(`${new URL(baseURL!).host}/${handle}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Thyme" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Finish setup with Thyme in your messaging app" })).toHaveCount(0);
});

for (const [button, confirmation] of [
  ["Approve this proposal", "You approved the sample request."],
  ["Decline", "You declined the sample request."],
  ["Request changes", "You requested changes to the sample."],
  ["End tutorial", "You ended the tutorial."],
]) {
  test(`a newly onboarded host sees the practice result after clicking ${button}`, async ({ baseURL, context, db, page }) => {
    const host = await signedInHost(db, context, baseURL!);
    await confirmedHost(db, host.hostAccountId, { displayName: "Tutorial Host", handle: uniqueHandle() }, baseURL!);
    await page.goto("/app");

    const links = card(page, "You're ready.");
    await expect(links.getByText(TUTORIAL_TEXT.en.offer)).toBeVisible({ timeout: 15_000 });
    await links.getByRole("button", { name: "Try it" }).click();

    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Alex Kim \(sample\)/ })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: "Approve this meeting?" })).toBeVisible();
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByText("No requests yet.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: confirmation, exact: true })).toBeVisible();
    await expect(page.getByText("This was practice. No calendar event was created and no guest was notified.")).toBeVisible();
    await expect(page.getByText("That request is not available.")).toHaveCount(0);
  });
}
