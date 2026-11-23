import type { Page } from "@playwright/test";
import { expect, signedInHost, test } from "./support/session";

// The /app host workspace (task 4.6) against the real web and agent services
// and the local Supabase stack. The host web has no chat with Thyme
// (remove-host-web-chat): the host talks to Thyme in the linked messenger.

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test("signed out, /app offers Google sign-in and no conversation", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/auth/sign-in");
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("the menu works by keyboard alone, closes on Escape and returns focus", async ({ baseURL, context, db, page }) => {
  await signedInHost(db, context, baseURL!);
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "Open menu" });
  await expect(trigger).toBeVisible({ timeout: 45_000 });

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
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
});

test("at 200% zoom the workspace has no horizontal scroll and no chat", async ({ baseURL, context, db, page }) => {
  // 200% browser zoom of a 1280x800 window lays the page out in a 640x400 CSS
  // viewport; Chromium's zoom is that viewport change at device scale 2.
  await page.setViewportSize({ height: 400, width: 640 });
  await signedInHost(db, context, baseURL!);
  await page.goto("/app");

  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("textbox", { name: "Message Thyme" })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  expect(await hasNoHorizontalScroll(page)).toBe(true);

  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeInViewport();
  expect(await hasNoHorizontalScroll(page)).toBe(true);
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

  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible({ timeout: 45_000 });
  expect(violations).toEqual([]);
});
