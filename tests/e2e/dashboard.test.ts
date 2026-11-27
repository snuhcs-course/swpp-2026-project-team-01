import { readyReviewHost } from "./support/host-review";
import { expect as baseExpect, signedInHost, test } from "./support/session";

// The host Dashboard's week view (chat-workspaces: host calendar Dashboard),
// against the real web service and the local Supabase Auth session: the week
// grid covers the host's open hours (#482), and the period controls and source
// filters stay at the top of the screen while the host scrolls (#481).

test.use({ locale: "en-US", timezoneId: "Asia/Seoul" });

const expect = baseExpect.configure({ timeout: 30_000 });

test("the week covers the host's open hours and keeps its controls in view while scrolling", async ({ baseURL, context, db, page }) => {
  await page.setViewportSize({ height: 700, width: 1280 });
  const host = await signedInHost(db, context, baseURL!);
  await readyReviewHost(db, host.hostAccountId, "Ada Lovelace");
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  await db`
    update app.host_settings
    set settings = jsonb_set(settings, '{weeklyWindows}', ${db.json(weekdays.map((weekday) => ({ end: "20:00", start: "10:00", weekday })) as never)})
    where host_account_id = ${host.hostAccountId}
  `;

  await page.goto("/app");
  const axis = page.locator(".hd-time-axis span");
  await expect(axis.first()).toHaveText("10:00");
  await expect(axis.last()).toHaveText("19:00");
  await expect(axis).toHaveCount(10);

  // Scrolled to the evening, the period title, navigation, view switch and
  // filters are still at the top of the screen.
  await page.locator(".hd-time-axis span", { hasText: "19:00" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  const title = page.locator(".hd-period h3");
  await expect.poll(async () => (await title.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => (await page.locator(".hd-calendar-head").boundingBox())?.y ?? -1).toBeLessThan(2);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect(page.getByRole("button", { name: "Next period" })).toBeInViewport();
  await expect(page.getByLabel("Requests to decide")).toBeInViewport();
  const wednesday = page.locator(".hd-day-head", { hasText: "Wed" });
  await expect(wednesday).toBeInViewport();

  // On a phone the toolbar and the day headers stay; the headers follow the
  // grid's sideways scroll.
  await page.setViewportSize({ height: 800, width: 390 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, 500);
  await expect(page.getByRole("button", { name: "Next period" })).toBeInViewport();
  await expect.poll(async () => {
    const toolbar = await page.locator(".hd-toolbar").boundingBox();
    const days = await page.locator(".hd-days").boundingBox();
    return toolbar && days ? Math.abs(days.y - (toolbar.y + toolbar.height)) : Infinity;
  }).toBeLessThan(1);
  await page.locator(".hd-week-scroll").evaluate((scroller) => { scroller.scrollLeft = 300; });
  await expect.poll(() => page.locator(".hd-days").evaluate((days) => days.scrollLeft)).toBe(300);
});
