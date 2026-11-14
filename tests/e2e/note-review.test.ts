import { noteReviewHost, runPendingWritebacks } from "./support/note-review";
import { expect, test } from "./support/session";

// The note review page (calendar-note-review task 3.1) as a week like Google
// Calendar, from a scan with the classifier's local stand-in to confirmed notes
// written free to Google Calendar, and back to change one, against the real web
// service, the local Supabase stack and the fake Google. The seed puts every
// entry in next week.

test("a host checks the note entries on the week, confirms them, and goes back to change one", async ({ baseURL, context, db, page }, testInfo) => {
  test.setTimeout(90_000);
  const host = await noteReviewHost(db, context, baseURL!, "en");

  await page.goto("/app/notes");
  await expect(page.getByRole("heading", { name: "Check the entries that are just notes" })).toBeVisible();
  // The review opens on this week; the week before it is not offered.
  await expect(page.getByRole("button", { name: "Previous week" })).toBeDisabled();
  const firstWeek = await page.locator("[data-note-week]").getAttribute("data-note-week");
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.locator("[data-note-week]")).not.toHaveAttribute("data-note-week", firstWeek!);
  const shownWeek = await page.locator("[data-note-week]").getAttribute("data-note-week");

  const grid = page.locator("[data-note-week-grid]");
  const box = (title: string) => grid.getByRole("checkbox", { name: new RegExp(`^${title}`) });
  // The other plans are grey context, not choices.
  for (const title of ["팀 회의", "점심 약속", "1:1 with 민지", "Client check-in"]) {
    await expect(grid.locator("[data-note-busy]").filter({ hasText: title })).toBeVisible();
    await expect(box(title)).toHaveCount(0);
  }
  // Recommended notes start checked; the rest start unchecked.
  // The subscribed Birthdays calendar's note is offered too, without a word
  // that it changes only in Find Me a Time.
  for (const title of ["엄마 생일", "분리수거", "과제 마감", "아빠 생일"]) await expect(box(title)).toBeChecked();
  await expect(page.getByText("Find Me a Time only")).toHaveCount(0);
  for (const title of ["헬스", "스터디 준비"]) await expect(box(title)).not.toBeChecked();
  // All-day entries sit in the row under the day headings.
  await expect(page.locator("[data-note-all-day]").filter({ hasText: "엄마 생일" })).toHaveCount(1);
  // The whole week fits on a desktop page, Sunday included, without scrolling.
  expect(await grid.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  // Choosing happens on the week itself.
  await box("과제 마감").uncheck();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("note-review-before.png") });

  await page.getByRole("button", { name: "Confirm" }).click();
  // After Confirm: a heading that says it is done, and only the freed entries
  // with their day and time, under one quiet line about Google.
  await expect(page.getByRole("heading", { name: "Your note entries are checked" })).toBeVisible();
  const freed = page.getByRole("region", { name: "Marked as free" });
  await expect(freed).toContainText("Saved to Google Calendar.");
  await expect(freed.locator("[data-note-decision]")).toHaveCount(3);
  await expect(freed.locator("[data-note-decision]").filter({ hasText: "엄마 생일" })).toContainText("All day");
  await expect(freed.locator("[data-note-decision]").filter({ hasText: "아빠 생일" })).toContainText("All day");
  await expect(freed.locator("[data-note-decision]").filter({ hasText: "분리수거" })).toContainText("9:00 PM");
  await expect(freed).not.toContainText("과제 마감");

  // This host set up on the web, with no linked chat, so the way out is Done.
  await expect(page.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/app");

  expect(await runPendingWritebacks(db, host.hostAccountId)).toBe(2);
  await expect(freed.locator('[data-note-decision="done"]')).toHaveCount(2, { timeout: 15_000 });
  await page.screenshot({ fullPage: true, path: testInfo.outputPath("note-review-after.png") });

  // Back shows the same week with the answers as they stand, to change one.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Check the entries that are just notes" })).toBeVisible();
  await expect(page.locator("[data-note-week]")).toHaveAttribute("data-note-week", shownWeek!);
  await expect(box("엄마 생일")).toBeChecked();
  await expect(box("과제 마감")).not.toBeChecked();
  await box("엄마 생일").uncheck();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(freed.locator("[data-note-decision]")).toHaveCount(2);
  await expect(freed).not.toContainText("엄마 생일");
  expect(await runPendingWritebacks(db, host.hostAccountId)).toBe(1);

  const recorded = await db<{ event_id: string; decision: string; scope: string; writeback_state: string | null }[]>`
    select event_id, decision, scope, writeback_state from app.calendar_note_decisions
    where host_account_id = ${host.hostAccountId} order by event_id
  `;
  expect(recorded).toEqual([
    { decision: "keep_busy", event_id: "assignment", scope: "occurrence", writeback_state: null },
    // The read-only calendar: freed in Find Me a Time only.
    { decision: "free", event_id: "dad", scope: "series", writeback_state: "not_writable" },
    { decision: "keep_busy", event_id: "gym", scope: "occurrence", writeback_state: null },
    // Freed, then kept busy again: Google has it opaque once more.
    { decision: "keep_busy", event_id: "mom-birthday", scope: "occurrence", writeback_state: "done" },
    // Checking an entry that repeats frees the whole series.
    { decision: "free", event_id: "recycling", scope: "series", writeback_state: "done" },
    { decision: "keep_busy", event_id: "study", scope: "occurrence", writeback_state: null },
  ]);
});
