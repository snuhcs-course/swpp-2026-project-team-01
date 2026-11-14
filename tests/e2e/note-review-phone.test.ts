import { noteReviewHost, NEXT_WEEK } from "./support/note-review";
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
  const host = await noteReviewHost(db, context, baseURL!, "ko");
  const { date, today } = seoulDates();

  await page.goto("/app/notes");
  await expect(page.getByRole("heading", { name: "메모 용도의 일정을 체크해주세요" })).toBeVisible();
  const grid = page.locator("[data-note-week-grid]");
  const range = page.locator("[data-note-range]");
  // Three days from today, nothing to scroll sideways, and nothing before today.
  await expect(grid.locator("[data-note-heading]")).toHaveCount(3);
  await expect(range).toHaveAttribute("data-note-range", `${date(today)}/${date(today + 2)}`);
  expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "이전 3일" })).toBeDisabled();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("note-review-phone-today.png") });

  // Three days ahead at a time, into next week, until 과제 마감's day is on screen.
  let first = today;
  while (first + 2 < NEXT_WEEK + 4) {
    await page.getByRole("button", { name: "다음 3일" }).click();
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
  await page.getByRole("button", { name: "이전 3일" }).click();
  await expect(range).toHaveAttribute("data-note-range", `${date(Math.max(today, first - 3))}/${date(Math.max(today, first - 3) + 2)}`);
  await page.getByRole("button", { name: "다음 3일" }).click();
  await expect(range).toHaveAttribute("data-note-range", `${date(first)}/${date(last)}`);

  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByRole("heading", { name: "메모 용도의 일정을 체크했습니다" })).toBeVisible();

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
