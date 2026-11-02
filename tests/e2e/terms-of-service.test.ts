import { expect, test } from "./support/session";

// The terms of service, P12 (data-stewardship: terms of service): English and
// Korean and their sections. The landing page's link is checked in privacy.test.ts.

for (const width of [390, 1280]) {
  test(`the terms read in English and Korean at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ height: 900, width });
    const response = await page.goto("/terms-of-service");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1, name: "Terms of service" })).toBeVisible();
    for (const name of ["The service", "Hosts", "People who book with a host", "AI agents and the assistant", "Acceptable use", "Warranties and liability"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByText(/booked only when the host approves the current proposal/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy and your data" })).toHaveAttribute("href", "/privacy");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("link", { name: "한국어" }).click();
    await expect(page).toHaveURL(/\/terms-of-service\?lang=ko$/);
    await expect(page.getByRole("heading", { level: 1, name: "이용약관" })).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("lang", "ko");
    await expect(page.getByRole("link", { name: "개인정보와 데이터" })).toHaveAttribute("href", "/privacy?lang=ko");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("link", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Terms of service" })).toBeVisible();
  });
}
