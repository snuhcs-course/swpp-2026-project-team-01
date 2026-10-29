import { makeHostReady, newHostAccount } from "../integration/support/ready-host";
import { expect, test } from "./support/session";

// The public data notice, P11 (data-stewardship: public data notice): English and
// Korean, its sections, and the links from the pages that carry it. The link from
// the Continue with Google card is checked in requester-intake.test.ts.

for (const width of [390, 1280]) {
  test(`the notice reads in English and Korean at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ height: 900, width });
    await page.goto("/privacy");

    await expect(page.getByRole("heading", { level: 1, name: "Privacy and your data" })).toBeVisible();
    for (const name of ["Who we are", "Hosts", "How we use your calendar", "Who processes your data", "How long we keep it", "Deleting your data"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByText(/storage turned off/)).toBeVisible();
    await expect(page.getByText(/90 days after it closed/)).toBeVisible();
    await expect(page.getByText(/support@findmeatime\.com/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("link", { name: "한국어" }).click();
    await expect(page).toHaveURL(/\/privacy\?lang=ko$/);
    await expect(page.getByRole("heading", { level: 1, name: "개인정보와 데이터" })).toBeVisible();
    await expect(page.locator("main")).toHaveAttribute("lang", "ko");
    await expect(page.locator("#calendar")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("link", { name: "English" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy and your data" })).toBeVisible();
  });
}

test("the landing page and a host page link to the notice", async ({ db, page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Privacy and your data" })).toHaveAttribute("href", "/privacy");

  const { handle } = await makeHostReady(db, await newHostAccount(db), { displayName: "Ada Lovelace" });
  await page.goto(`/${handle}`);
  await expect(page.getByRole("link", { name: "How we handle your data" })).toHaveAttribute("href", "/privacy");
});
