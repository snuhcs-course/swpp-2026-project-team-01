import { expect, test } from "@playwright/test";

test("home offers Google sign-in", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Find Me a Time" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute(
    "href",
    "/auth/sign-in",
  );
});

test("app renders the conversation composer", async ({ page }) => {
  await page.goto("/app");

  await expect(page.getByRole("textbox")).toBeVisible();
});
