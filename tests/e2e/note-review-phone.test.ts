import { NEXT_WEEK, noteReviewHost, OVERLAPPING_MEETING, pressEntry } from "./support/note-review";
import { expect, test } from "./support/session";

// The note review on a phone (calendar-note-review task 3.2): three days at a
// time from today instead of the week scrolled sideways, the arrows moving
// three days and crossing into next week, where the seed puts every entry. 확인
// records only the candidates whose day has been on screen.

test.use({ viewport: { height: 812, width: 375 } });

const DAY = 86_400_000;

// Days counted from this week's Monday in Seoul, as the seed counts them.
function seoulDates() {
  const seoulToday = new Date(Date.now() + 9 * 3_600_000);
  const weekday = (seoulToday.getUTCDay() + 6) % 7;
  const monday = Date.UTC(seoulToday.getUTCFullYear(), seoulToday.getUTCMonth(), seoulToday.getUTCDate() - weekday);
  return { date: (offset: number) => new Date(monday + offset * DAY).toISOString().slice(0, 10), today: weekday };
}

// The seed's candidates by the day they are on (분리수거 repeats weekly from day 8).
const CANDIDATES = [
  { day: NEXT_WEEK + 1, eventId: "gym", free: false },
  { day: NEXT_WEEK + 1, eventId: "recycling", free: true },
  { day: NEXT_WEEK + 2, eventId: "mom-birthday", free: true },
  { day: NEXT_WEEK + 3, eventId: "study", free: false },
  { day: NEXT_WEEK + 4, eventId: "assignment", free: true },
  { day: NEXT_WEEK + 5, eventId: "dad", free: true },
];

test("on a phone the review shows three days at a time and records only the days shown", async ({ baseURL, context, db, page }, testInfo) => {
  test.setTimeout(90_000);
  const host = await noteReviewHost(db, context, baseURL!, "en");
  const { date, today } = seoulDates();

  await page.goto("/app/notes");
  await expect(page.getByRole("heading", { name: "Check the entries that are just notes" })).toBeVisible();
  const grid = page.locator("[data-note-week-grid]");
  const range = page.locator("[data-note-range]");
  // Three days from today, nothing to scroll sideways, and nothing before today.
  await expect(grid.locator("[data-note-heading]")).toHaveCount(3);
  await expect(range).toHaveAttribute("data-note-range", `${date(today)}/${date(today + 2)}`);
  expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Previous 3 days" })).toBeDisabled();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("note-review-phone-today.png") });

  // Three days ahead at a time, into next week, until 과제 마감's day is on screen.
  let first = today;
  while (first + 2 < NEXT_WEEK + 4) {
    await page.getByRole("button", { name: "Next 3 days" }).click();
    first += 3;
    await expect(range).toHaveAttribute("data-note-range", `${date(first)}/${date(first + 2)}`);
  }
  const last = first + 2;
  // Next week's Monday came from a second week's load, with its grey meeting.
  await expect(page.locator(`[data-note-day="${date(NEXT_WEEK)}"]`)).toHaveCount(first <= NEXT_WEEK ? 1 : 0);
  await expect(grid.locator("[data-note-busy]").filter({ hasText: "점심 약속" })).toHaveCount(first <= NEXT_WEEK + 1 ? 1 : 0);
  await expect(grid.getByRole("checkbox", { name: /^과제 마감/ })).toBeChecked();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("note-review-phone-next-week.png") });

  // Back three days, then ahead again: the same days come back.
  await page.getByRole("button", { name: "Previous 3 days" }).click();
  await expect(range).toHaveAttribute("data-note-range", `${date(Math.max(today, first - 3))}/${date(Math.max(today, first - 3) + 2)}`);
  await page.getByRole("button", { name: "Next 3 days" }).click();
  await expect(range).toHaveAttribute("data-note-range", `${date(first)}/${date(last)}`);

  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Your note entries are checked" })).toBeVisible();

  // Only the candidates on days that were on screen are answered.
  const recorded = await db<{ event_id: string; decision: string }[]>`
    select event_id, decision from app.calendar_note_decisions
    where host_account_id = ${host.hostAccountId} order by event_id
  `;
  const shown = CANDIDATES.filter((candidate) => candidate.day <= last);
  expect(recorded).toEqual(
    shown
      .map((candidate) => ({ decision: candidate.free ? "free" : "keep_busy", event_id: candidate.eventId }))
      .sort((a, b) => a.event_id.localeCompare(b.event_id)),
  );
  // 과제 마감 is always among them; a later day never is.
  expect(recorded.map((row) => row.event_id)).toContain("assignment");
  if (last < NEXT_WEEK + 5) expect(recorded.map((row) => row.event_id)).not.toContain("dad");
});

test("on a phone an entry opens its details within the screen, and only the checkbox strip toggles it", async ({ baseURL, context, db, page }, testInfo) => {
  test.setTimeout(90_000);
  await noteReviewHost(db, context, baseURL!, "en");
  const { date, today } = seoulDates();

  await page.goto("/app/notes");
  const grid = page.locator("[data-note-week-grid]");
  const range = page.locator("[data-note-range]");
  // Ahead three days at a time until 헬스's day (next Tuesday) is on screen.
  let first = today;
  while (first + 2 < NEXT_WEEK + 1) {
    await page.getByRole("button", { name: "Next 3 days" }).click();
    first += 3;
    await expect(range).toHaveAttribute("data-note-range", `${date(first)}/${date(first + 2)}`);
  }

  const box = grid.getByRole("checkbox", { name: /^헬스/ });
  // The label around the checkbox.
  const strip = box.locator("xpath=..");
  const entry = grid.getByRole("button", { name: /^헬스 .*, Details$/ });
  const details = page.locator("[data-note-details]");
  await expect(box).not.toBeChecked();

  // The checkbox's strip is a big enough tap target and toggles only.
  await strip.scrollIntoViewIfNeeded();
  const target = (await strip.boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(24);
  expect(target.width).toBeGreaterThanOrEqual(24);
  // Beside the checkbox itself, inside its corner.
  await page.mouse.click(target.x + target.width - 3, target.y + target.height - 3);
  await expect(box).toBeChecked();
  await expect(details).toBeHidden();

  // However narrow the block, the rest of it is the details button: a press
  // below the checkbox's corner opens the details.
  const button = (await entry.boundingBox())!;
  expect(button.width).toBeGreaterThanOrEqual(24);
  await page.mouse.click(button.x + 4, button.y + button.height - 6);
  await expect(details).toBeVisible();
  await expect(box).toBeChecked();
  await page.keyboard.press("Escape");

  // Pressing the entry opens its details inside the screen; pressing it again closes them.
  await pressEntry(entry);
  await expect(details.locator("[data-note-details-title]")).toHaveText("헬스");
  await expect(details.locator("[data-note-description]")).toContainText("PT는 7시 반");
  const panel = (await details.boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(375);
  await expect(box).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("note-review-phone-details.png") });
  await pressEntry(entry);
  await expect(details).toBeHidden();

  // The long-titled meeting beside it reads in full.
  await grid.getByRole("button", { name: `${OVERLAPPING_MEETING} 7:00 PM, Details` }).click();
  await expect(details.locator("[data-note-details-title]")).toHaveText(OVERLAPPING_MEETING);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
