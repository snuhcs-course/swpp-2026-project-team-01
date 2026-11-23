import { expect, type Page } from "@playwright/test";

// Since #213 the workspace menu has no iMessage or Connected agents item: both
// live in the Connected apps dialog, whose messaging section opens the
// messaging card with "Connect a messaging app" (or "Manage messaging app"
// once linked).
export async function openConnectedApps(page: Page) {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Connected apps" }).click();
  const dialog = page.getByRole("dialog", { name: "Connected apps" });
  await expect(dialog).toBeVisible();
  return dialog;
}

// Opens /app, waits for the workspace, then the messaging card in Connected apps.
export async function openMessagingCard(page: Page) {
  await page.goto("/app");
  const menu = page.getByRole("button", { name: "Open menu" });
  await expect(menu).toBeVisible({ timeout: 45_000 });
  // The workspace has loaded, so nothing moves focus after the menu does.
  await expect(page.getByRole("main", { name: "Workspace" })).toBeVisible({ timeout: 45_000 });
  const dialog = await openConnectedApps(page);
  await dialog.getByRole("button", { name: /^(Connect a messaging app|Manage messaging app)$/ }).click();
  const card = dialog.locator("[data-imessage-card]");
  await expect(card).toBeVisible({ timeout: 15_000 });
  return card;
}
