import type { Page } from "@playwright/test";
import { agreedReviewRequest, readyReviewHost, runBookings } from "./support/host-review";
import { signInHost } from "../integration/support/auth";
import { expect, signedInHost, test } from "./support/session";

// The host's review of a request in /app (tasks 3.3, 3.4 and 6.1) against the
// real web and agent services, the local Supabase stack, the fake Google and the
// OpenAI stand-in: the inbox, the private and shared switch by keyboard, the
// proposal review, approval, the booking job and the receipt on both sides.

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
    await page.waitForURL((url) => url.searchParams.get("request") === request.requestId);

    // The private discussion with the proposal review card.
    const privateTab = page.getByRole("tab", { name: "Private with Thyme" });
    await expect(privateTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Approve this meeting?" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // The shared conversation, read-only, by keyboard.
    await privateTab.focus();
    await page.keyboard.press("ArrowRight");
    const sharedTab = page.getByRole("tab", { name: "Shared with Grace Hopper" });
    await expect(sharedTab).toHaveAttribute("aria-selected", "true");
    await expect(sharedTab).toBeFocused();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve this proposal" })).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");

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
