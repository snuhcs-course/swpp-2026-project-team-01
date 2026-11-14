import { noteReviewHost, runPendingWritebacks } from "./support/note-review";
import { test } from "./support/session";

// A hand preview of the note review, not a check: it signs in a host whose
// calendars hold typical notes, opens /app/notes in a visible browser and pauses,
// so a person can look, click and edit the component (next dev reloads it) while
// writebacks run every two seconds against the fake Google. It runs only when
// asked for:
//
//   NOTE_REVIEW_PREVIEW=1 npx playwright test note-review-preview --headed
//
// Press Resume in the Playwright Inspector to end it. NOTE_REVIEW_PREVIEW_LOCALE=ko
// shows the Korean copy.

test.skip(process.env.NOTE_REVIEW_PREVIEW !== "1", "Set NOTE_REVIEW_PREVIEW=1 to open the preview.");

test("preview the note review", async ({ baseURL, context, db, page }) => {
  test.setTimeout(0);
  const host = await noteReviewHost(db, context, baseURL!, process.env.NOTE_REVIEW_PREVIEW_LOCALE === "ko" ? "ko" : "en");
  const writebacks = setInterval(() => void runPendingWritebacks(db, host.hostAccountId).catch(() => {}), 2000);

  try {
    await page.goto("/app/notes");
    await page.pause();
  } finally {
    clearInterval(writebacks);
  }
});
