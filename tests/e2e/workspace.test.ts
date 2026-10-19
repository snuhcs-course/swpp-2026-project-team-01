import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, scriptModelReply, signedInHost, test } from "./support/session";

// The /app host workspace (task 4.6) against the real web and agent services,
// the local Supabase stack and a local model stand-in that answers
// "Hello from Thyme.".

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message Thyme" });
  await composer.fill(text);
  await composer.press("Enter");
}

test("signed out, /app offers Google sign-in and no conversation", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/sign-in");
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

for (const width of [320, 390, 1280]) {
  test(`at ${width}px the conversation is centered with a reachable composer and no sidebar`, async ({
    baseURL,
    context,
    db,
    page,
  }) => {
    await page.setViewportSize({ height: width === 1280 ? 800 : 700, width });
    await signedInHost(db, context, baseURL!);
    await page.goto("/app");

    const composer = page.getByRole("textbox", { name: "Message Thyme" });
    await expect(composer).toBeInViewport();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    await sendMessage(page, "Find me a time next week.");
    const log = page.getByRole("log", { name: "Messages" });
    await expect(log.getByText("Find me a time next week.")).toBeVisible();
    await expect(log.getByText("Hello from Thyme.")).toBeVisible();
    await expect(composer).toBeInViewport();
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // The conversation column stays centered.
    const box = (await log.getByText("Hello from Thyme.").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
}

test("the menu works by keyboard alone, closes on Escape and returns focus", async ({ baseURL, context, db, page }) => {
  await signedInHost(db, context, baseURL!);
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Open menu" });
  await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeEnabled();

  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  // Open with the keyboard and sign out with the keyboard.
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/app");
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
});

test("at 200% zoom the workspace has no horizontal scroll", async ({ baseURL, context, db, page }) => {
  // 200% browser zoom of a 1280x800 window lays the page out in a 640x400 CSS
  // viewport; Chromium's zoom is that viewport change at device scale 2.
  await page.setViewportSize({ height: 400, width: 640 });
  await signedInHost(db, context, baseURL!);
  await page.goto("/app");

  await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeInViewport();
  await sendMessage(page, "A long message that wraps across several lines at this zoom level ".repeat(4));
  await expect(page.getByRole("log", { name: "Messages" }).getByText("Hello from Thyme.")).toBeVisible();
  expect(await hasNoHorizontalScroll(page)).toBe(true);

  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeInViewport();
  expect(await hasNoHorizontalScroll(page)).toBe(true);
});

test("saved history stays readable after the model allowance is exhausted", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  await page.goto("/app");
  await sendMessage(page, "Tuesdays work best.");
  const log = page.getByRole("log", { name: "Messages" });
  await expect(log.getByText("Hello from Thyme.")).toBeVisible();

  // The host's USD 30 window is spent.
  await db`
    insert into app.model_reservations (work_kind, work_id, principal_type, principal_id, amount_usd, window_start)
    select 'conversation_input', gen_random_uuid(), 'host_account', ${host.hostAccountId}, 0.60,
           date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
    from generate_series(1, 50)
  `;
  await sendMessage(page, "And Thursdays?");
  await expect(log.getByText("And Thursdays?")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeEnabled({ timeout: 30_000 });
  await expect(log.getByText("Hello from Thyme.")).toHaveCount(1);
  // The missing reply is explained safely, with no provider or limit detail.
  await expect(page.getByText("Thyme couldn't finish this reply.", { exact: false })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/principal_allowance|ModelLimitError|MODEL_CALL_FAILED/);

  await page.reload();
  await expect(log.getByText("Tuesdays work best.")).toBeVisible();
  await expect(log.getByText("Hello from Thyme.")).toBeVisible();
  await expect(log.getByText("And Thursdays?")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeEnabled();
});

test("Restart Thyme recovers a failed conversation and keeps the message once", async ({
  baseURL,
  context,
  db,
  page,
}) => {
  await signedInHost(db, context, baseURL!);
  const text = `Mornings work best. ${randomUUID()}`;
  // The model rejects this conversation's key, which ends the session.
  await scriptModelReply(text, { code: "invalid_api_key", kind: "error", status: 401 });
  await page.goto("/app");
  await sendMessage(page, text);

  const restart = page.getByRole("button", { name: "Restart Thyme" });
  await expect(page.getByText("Thyme stopped responding in this conversation.", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("body")).not.toContainText(/invalid_api_key|Scripted failure/);

  await restart.click();
  const log = page.getByRole("log", { name: "Messages" });
  await expect(log.getByText("Hello from Thyme.")).toBeVisible({ timeout: 30_000 });
  await expect(restart).toHaveCount(0);
  await expect(log.getByText(text)).toHaveCount(1);

  await page.reload();
  await expect(log.getByText("Hello from Thyme.")).toBeVisible();
  await expect(log.getByText(text)).toHaveCount(1);
});

test("the workspace runs under the security headers with no policy violation", async ({ baseURL, context, db, page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Refused to load: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await signedInHost(db, context, baseURL!);
  const response = (await page.goto("/app"))!;
  const headers = response.headers();

  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");

  await sendMessage(page, "Find me a time next week.");
  await expect(page.getByRole("log", { name: "Messages" }).getByText("Hello from Thyme.")).toBeVisible();
  expect(violations).toEqual([]);
});
