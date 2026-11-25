import type { Page } from "@playwright/test";
import { MONDAY, seoul } from "../integration/support/scheduling";
import { agreedReviewRequest, readyReviewHost, runBookings } from "./support/host-review";
import { signInHost } from "../integration/support/auth";
import { expect, signedInHost, test } from "./support/session";

// The host's review of a request in /app (tasks 3.3, 3.4 and 6.1) against the
// real web and agent services, the local Supabase stack, the fake Google and the
// OpenAI stand-in: the inbox accordion with no view of the
// requester's conversation, the proposal review, approval, the booking job and
// the receipt on both sides.

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

for (const width of [390, 1280]) {
  test(`at ${width}px the host approves from the inbox and both sides see the receipt`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: width === 1280 ? 800 : 760, width });
    const host = await signedInHost(db, context, baseURL!);
    await readyReviewHost(db, host.hostAccountId);
    const request = await agreedReviewRequest(db, host.hostAccountId);

    // The inbox, from the menu, by keyboard.
    await page.goto("/app");
    await page.getByRole("button", { name: "Open menu" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Requests" }).click();
    await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
    const card = page.getByRole("button", { name: /Grace Hopper/ });
    await expect(card).toContainText("Needs your decision");
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");

    // The proposal appears in the list without a private discussion or a way
    // to the requester's own conversation.
    await expect(page.getByRole("log", { name: "Private messages" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Approve this meeting?" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Thyme" })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    expect(await hasNoHorizontalScroll(page)).toBe(true);
    expect((await page.request.get(`/api/host/requests/${request.requestId}/shared`)).status()).toBe(404);

    // Approval reserves the booking; the job creates the event.
    const approve = page.getByRole("button", { name: "Approve this proposal" });
    await approve.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Booking in progress" })).toBeVisible();
    expect(await runBookings(db, request.requestId, baseURL!)).toBe(1);
    await page.getByRole("button", { name: "Check booking status" }).click();
    await expect(page.getByRole("heading", { name: "Booked" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Join meeting" })).toHaveAttribute("href", /^https:\/\/meet\.google\.com\//);
    await expect(page.getByRole("link", { name: "Open in Google Calendar" })).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // The requester's booking link shows the same receipt, read-only.
    const guest = await context.browser()!.newPage({ viewport: { height: 760, width } });
    await guest.goto(`/booking/${request.bookingId}`);
    await expect(guest.getByText("Talk about compilers").first()).toBeVisible();
    await expect(guest.getByRole("link", { name: "Join meeting" })).toHaveAttribute("href", /^https:\/\/meet\.google\.com\//);
    await expect(guest.getByRole("link", { name: "Open in Google Calendar" })).toHaveCount(0);
    await guest.close();

    // The host cancels the booked meeting after confirming once (post-booking-changes).
    await page.getByRole("button", { name: "Cancel meeting" }).click();
    await expect(page.getByRole("group", { name: "Confirm cancellation" })).toBeVisible();
    await page.getByRole("group", { name: "Confirm cancellation" }).getByRole("button", { name: "Cancel meeting" }).click();
    await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel meeting" })).toHaveCount(0);
  });
}

// calendar-views task 4.2 (#147): the host's own week beside the proposal,
// with the proposed time marked over their events, and a time picked on it
// filling in Request changes without sharing anything.
const FIRST_HOUR = 8; // DEFAULT_HOURS[0] in calendar-time.ts; the 10:00 proposal and 12:00 lunch stay inside it.
const HOUR_PX = { narrow: 88, wide: 48 }; // HOUR_PX and NARROW_HOUR_PX in week-calendar.tsx.

for (const width of [390, 1280]) {
  test(`at ${width}px the host picks a new time on their own calendar beside the proposal`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: width === 1280 ? 800 : 760, width });
    const host = await signedInHost(db, context, baseURL!);
    await readyReviewHost(db, host.hostAccountId, "Ada Lovelace", [
      { end: seoul("13:00"), id: "lunch", start: seoul("12:00"), summary: "Lunch with Barbara" },
    ]);
    const request = await agreedReviewRequest(db, host.hostAccountId);

    await page.goto(`/app?request=${request.requestId}`);
    await expect(page.getByRole("heading", { name: "Approve this meeting?" })).toBeVisible();

    // The week (one day on a phone) opens at the proposal, marked over the host's events.
    const calendar = page.getByRole("region", { name: "Your calendar with this request's times" });
    await expect(calendar).toBeVisible();
    await expect(calendar.getByRole("list", { name: "Your events" })).toContainText("Lunch with Barbara");
    await expect(calendar.getByRole("list", { name: "This request's times" })).toContainText(/Proposed time: .*10:00/);
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // Clicking 14:00 on the proposal's day opens Request changes with that time.
    const narrow = (await calendar.getAttribute("data-narrow")) !== null;
    expect(narrow).toBe(width === 390);
    const hourPx = narrow ? HOUR_PX.narrow : HOUR_PX.wide;
    const column = calendar.locator(".cw-column").first();
    await column.scrollIntoViewIfNeeded();
    const box = (await column.boundingBox())!;
    await column.click({ position: { x: box.width / 2, y: (14 - FIRST_HOUR) * hourPx + 4 } });

    await expect(page.getByRole("heading", { name: "What should change?" })).toBeVisible();
    await expect(page.getByLabel("Date")).toHaveValue(MONDAY);
    await expect(page.getByLabel("Start time")).toHaveValue("14:00");
    await expect(calendar.getByRole("list", { name: "This request's times" })).toContainText(/New time you are suggesting: .*14:00/);

    // Nothing reaches the requester until the host shares the suggestion.
    const [row] = await db<{ revision: number; state: string }[]>`select revision, state from app.requests where id = ${request.requestId}`;
    expect(row).toEqual({ revision: 2, state: "awaiting_host_approval" });
    expect(await hasNoHorizontalScroll(page)).toBe(true);
  });
}

test("a request of another host opens the inbox with nothing selected", async ({ baseURL, context, db, page }) => {
  const mine = await signedInHost(db, context, baseURL!);
  await readyReviewHost(db, mine.hostAccountId);
  const other = await signInHost(db);
  await readyReviewHost(db, other.hostAccountId);
  const theirs = await agreedReviewRequest(db, other.hostAccountId);

  await page.goto(`/app?request=${theirs.requestId}`);
  await expect(page.getByText("That request is not available.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toHaveCount(0);
});
