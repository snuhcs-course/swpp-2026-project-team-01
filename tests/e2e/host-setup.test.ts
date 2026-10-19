import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { runCommand } from "../../lib/server/commands";
import { updateDraftCommand } from "../../lib/server/setup-commands";
import { draftRevision, hostCommandDeps } from "../integration/support/setup-host";
import { acceptSuggestions, grantCalendar, reviewableHost, runPendingAnalyses } from "./support/setup-host";
import { expect, signedInHost, test } from "./support/session";

// Host setup in /app (host-onboarding tasks for the cards): the authored
// messages, one step card at a time, confirmation and the public pages, against the real
// web and agent services, the local Supabase stack, the fake Google on port 3103
// (its default fixture) and the local model stand-in. The analysis job runs from
// the test process, since the job worker is production-only.

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

function card(page: Page, name: string | RegExp) {
  return page.getByRole("region", { name });
}

function uniqueHandle() {
  return `e2e${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

// Exactly one setup card is shown, and it is the named one.
async function expectOnlyCard(page: Page, name: string | RegExp) {
  await expect(card(page, name)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-setup-card]")).toHaveCount(1);
}

// The current card fits whole in the conversation, above the composer.
async function expectCardFits(page: Page) {
  const setupCard = page.locator("[data-setup-card]");
  await setupCard.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const [box, log, composer] = await Promise.all([
        setupCard.boundingBox(),
        page.getByRole("log", { name: "Messages" }).boundingBox(),
        page.getByRole("textbox", { name: "Message Thyme" }).boundingBox(),
      ]);
      if (!box || !log || !composer) return "not laid out";
      if (box.y < log.y - 1) return `top ${box.y} above the conversation at ${log.y}`;
      if (box.y + box.height > Math.min(log.y + log.height, composer.y) + 1) {
        return `bottom ${box.y + box.height} below the composer at ${composer.y}`;
      }
      return "fits";
    })
    .toBe("fits");
}

test("a new host completes setup one card at a time, from the authored messages to working public pages", async ({
  baseURL,
  context,
  db,
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ height: 844, width: 390 });
  const host = await signedInHost(db, context, baseURL!);
  await grantCalendar(db, host.hostAccountId);
  await page.goto("/app");

  // The authored messages open the conversation, then the calendar step's card.
  const log = page.getByRole("log", { name: "Messages" });
  await expect(log.getByText("Hi, I'm Thyme. I'll help you set up how people book one-to-one meetings with you.")).toBeVisible();
  await expect(log.getByText("Your Google Calendar is connected.")).toBeVisible();
  await expect(log.getByText("Next, choose which calendars I check for conflicts and where I add bookings.")).toBeVisible();

  await expectOnlyCard(page, "Choose your calendars");
  await expectCardFits(page);
  const calendars = card(page, "Choose your calendars");
  // Two calendars named "Shared" show their IDs; only writable calendars are
  // offered for bookings, so the read-only one is not.
  await expect(calendars.getByRole("checkbox", { name: /shared-reader@group\.calendar\.google\.com/ })).toBeVisible();
  await expect(calendars.getByRole("checkbox", { name: /host@example\.test/ })).toBeChecked();
  await expect(calendars.getByRole("checkbox", { name: /Holidays in South Korea/ })).not.toBeChecked();
  const booking = calendars.getByLabel("Add bookings to");
  await expect(booking).toHaveValue("host@example.test");
  await expect(booking.locator("option")).toHaveText([/^host@example\.test/, /^Shared \(shared-writer@group\.calendar\.google\.com\)/]);
  await expect(calendars.getByRole("link", { name: /Manage Google connection/ })).toHaveAttribute(
    "href",
    "https://myaccount.google.com/connections",
  );
  await calendars.getByRole("button", { name: "Save calendars" }).click();

  // The disclosed scan alone, then the first suggestion once the job has run.
  await expectOnlyCard(page, "Reading your calendars");
  const analysis = card(page, "Reading your calendars");
  await expect(analysis.getByText("This can take a minute.")).toBeVisible();
  await expect(analysis.getByRole("heading", { name: "Reading your calendars" })).toBeFocused();
  expect(await runPendingAnalyses(db, host.hostAccountId)).toBe(1);

  // Step 1: the time zone, with the scan's evidence folded away.
  await expectOnlyCard(page, "Which time zone do you meet in?");
  const timezone = card(page, "Which time zone do you meet in?");
  await expect(timezone.getByRole("heading", { name: "Which time zone do you meet in?" })).toBeFocused();
  await expect(timezone.getByText("Step 1 of 7")).toBeVisible();
  await expectCardFits(page);
  await expect(timezone.getByText("Blue Bottle Coffee", { exact: true })).toBeHidden();
  await timezone.getByRole("button", { name: "What I found" }).click();
  await expect(timezone.getByText("Busiest times")).toBeVisible();
  await expect(timezone.getByText("Blue Bottle Coffee", { exact: true })).toBeVisible();
  await timezone.getByRole("button", { name: "Use this" }).click();

  // Step 2: inferred values carry their sample.
  await expectOnlyCard(page, "When can people book you?");
  const windows = card(page, "When can people book you?");
  await expect(windows.getByText(/^Inferred · \d+ meetings$/)).toBeVisible();
  // Back returns to the answered step, which offers Keep this.
  await windows.getByRole("button", { name: "Back" }).click();
  await expectOnlyCard(page, "Which time zone do you meet in?");
  await card(page, "Which time zone do you meet in?").getByRole("button", { name: "Keep this" }).click();
  await expectOnlyCard(page, "When can people book you?");
  await windows.getByRole("button", { name: "Use this" }).click();

  // Step 3 is skipped for now; it stays listed in the review.
  await expectOnlyCard(page, "How many meetings a week, at most?");
  await card(page, "How many meetings a week, at most?").getByRole("button", { name: "Skip for now" }).click();

  await expectOnlyCard(page, "How long are meetings, with what buffers?");
  await card(page, "How long are meetings, with what buffers?").getByRole("button", { name: "Use this" }).click();

  // Note-like entries stay busy until the host frees one.
  await expectOnlyCard(page, "Should any of these entries leave you free?");
  const notes = card(page, "Should any of these entries leave you free?");
  const exclude = notes.getByRole("checkbox", { name: /Exclude from busy time: Focus time/ });
  await expect(exclude).not.toBeChecked();
  await exclude.click();
  await expect(exclude).toBeChecked();
  await notes.getByRole("button", { name: "Free 1 entry" }).click();

  const modeName = "Do you prefer online meetings, in-person meetings, or either?";
  await expectOnlyCard(page, modeName);
  await expectCardFits(page);
  // Answers are Questionnaire choices: choosing selects, Continue saves.
  const mode = card(page, modeName);
  await mode.getByRole("radio", { name: "Online" }).check();
  await mode.getByRole("button", { name: "Continue" }).click();

  // Online leaves out the in-person steps; the identity step comes last.
  await expectOnlyCard(page, "What should your booking page show?");
  const identity = card(page, "What should your booking page show?");
  await expect(identity.getByText("Step 7 of 7")).toBeVisible();
  const displayName = await identity.getByLabel("Display name").inputValue();
  expect(displayName.length).toBeGreaterThan(0);
  const handle = uniqueHandle();
  await identity.getByLabel("Handle").fill(handle);
  await expect(identity.getByText("Available.")).toBeVisible();
  await identity.getByRole("button", { name: "Save" }).click();

  // The review: one compact list, with the skipped step marked as only proposed.
  await expectOnlyCard(page, "Review your booking settings");
  const review = card(page, "Review your booking settings");
  await expect(review.getByRole("heading", { name: "Review your booking settings" })).toBeFocused();
  await expect(review.getByText("1 excluded from busy time")).toBeVisible();
  await expect(review.getByText(`/${handle}`)).toBeVisible();
  await expect(review.getByText("Proposed, not reviewed")).toHaveCount(1);
  // Edit opens that step's card and returns to the review.
  await review.getByRole("button", { name: "Edit time zone" }).click();
  await expectOnlyCard(page, "Which time zone do you meet in?");
  await card(page, "Which time zone do you meet in?").getByRole("button", { name: "Keep and return" }).click();
  await expectOnlyCard(page, "Review your booking settings");

  await review.getByRole("button", { name: "Confirm and save proposed settings" }).click();

  await expectOnlyCard(page, "You're ready.");
  const links = card(page, "You're ready.");
  await expect(links.getByRole("heading", { name: "You're ready." })).toBeFocused();
  await expect(links.getByText(`${baseURL}/${handle}`, { exact: true })).toBeVisible();
  await expect(links.getByText(`${baseURL}/${handle}/SKILL.md`, { exact: true })).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await links.getByRole("button", { name: "Copy booking link" }).click();
  await expect(links.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/${handle}`);

  // The public pages exist only now.
  await page.goto(`/${handle}`);
  await expect(page.getByRole("heading", { name: displayName })).toBeVisible();
  await expect(page.getByRole("region", { name: "For AI agents" })).toBeVisible();
  const skill = await page.request.get(`/${handle}/SKILL.md`);
  expect(skill.status()).toBe(200);
  expect(skill.headers()["content-type"]).toContain("text/markdown");
  expect(await skill.text()).toContain(handle);
});

test("declined Calendar scopes show Connect Google Calendar with the consent link", async ({ baseURL, context, db, page }) => {
  await signedInHost(db, context, baseURL!);
  await page.goto("/app");

  const log = page.getByRole("log", { name: "Messages" });
  await expect(log.getByText("Your Google Calendar isn't connected yet. Connect it so I can see your calendars.")).toBeVisible();
  await expectOnlyCard(page, "Connect Google Calendar");
  const connect = card(page, "Connect Google Calendar");
  await expect(connect.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
    "href",
    "/auth/sign-in?consent=calendar",
  );
  await expect(connect.getByText(/Signed in as host-.+@example\.test/)).toBeVisible();
  await expect(log.getByText("Next, choose which calendars", { exact: false })).toHaveCount(0);

  // Unrelated preferences stay editable before Calendar is connected, in the
  // same one-card stepper; Back on its first step returns to Connect.
  await connect.getByRole("button", { name: "Set other preferences now" }).click();
  await expectOnlyCard(page, "Which time zone do you meet in?");
  await card(page, "Which time zone do you meet in?").getByRole("button", { name: "Back" }).click();
  await expectOnlyCard(page, "Connect Google Calendar");
});

test("authored messages reveal one at a time on a first visit and at once on a revisit or under reduced motion", async ({
  baseURL,
  browser,
  context,
  db,
  page,
}) => {
  const host = await signedInHost(db, context, baseURL!);
  await grantCalendar(db, host.hostAccountId);
  const shownWhenFirstAppears = async (target: Page) => {
    await target.locator("[data-authored-message]").first().waitFor();
    return target.locator("[data-authored-message]").count();
  };

  await page.goto("/app");
  expect(await shownWhenFirstAppears(page)).toBe(1);
  await expect(page.locator("[data-authored-message]")).toHaveCount(3);
  await expect(card(page, "Choose your calendars")).toBeVisible();

  // The same browser remembers what it showed this host.
  await page.reload();
  expect(await shownWhenFirstAppears(page)).toBe(3);

  // A fresh browser that prefers reduced motion shows everything at once.
  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  await reduced.addCookies(await context.cookies());
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${baseURL}/app`);
  expect(await shownWhenFirstAppears(reducedPage)).toBe(3);
  await reduced.close();
});

test("a stale review is rejected and nothing is saved", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  await reviewableHost(db, host.hostAccountId);
  await acceptSuggestions(db, host.hostAccountId, { displayName: "E2E Host", handle: uniqueHandle() });
  await page.goto("/app");

  await expectOnlyCard(page, "Review your booking settings");
  const review = card(page, "Review your booking settings");
  const confirm = review.getByRole("button", { name: "Confirm and save proposed settings" });
  await expect(confirm).toBeEnabled();

  // A second request changes the draft after this review loaded.
  const changed = await runCommand(hostCommandDeps(db, host.hostAccountId), updateDraftCommand, {
    expectedRevision: await draftRevision(db, host.hostAccountId),
    input: { action: "adjust", field: "bufferBeforeMinutes", value: 25 },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
  expect(changed.ok).toBe(true);

  await confirm.click();
  await expect(review.getByText("This changed since you last saw it.", { exact: false })).toBeVisible();
  // The reloaded review shows the newer value; nothing was confirmed.
  await expect(review.getByText("25 min before")).toBeVisible();
  const settings = await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`;
  expect(settings).toHaveLength(0);
  await expect(card(page, "You're ready.")).toHaveCount(0);
});

test("a mode the assistant recorded shows as You said and counts only after Use this", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  await reviewableHost(db, host.hostAccountId);
  await acceptSuggestions(db, host.hostAccountId, { displayName: "E2E Host", handle: uniqueHandle() });
  // As draft_settings leaves it: stated in the conversation, not accepted on the card.
  await db`
    update app.setup_drafts
    set fields = jsonb_set(fields, '{meetingMode}', ${db.json({ accepted: false, source: "stated", value: "online" })})
    where host_account_id = ${host.hostAccountId}
  `;
  await page.goto("/app");

  // The mode is the only open step, so it is the one card shown.
  const modeName = "Do you prefer online meetings, in-person meetings, or either?";
  await expectOnlyCard(page, modeName);
  const mode = card(page, modeName);
  await expect(mode.getByText("You said:")).toBeVisible();
  await expect(mode.getByRole("radio", { name: "Online" })).not.toBeChecked();

  await mode.getByRole("button", { name: "Use this" }).click();

  await expectOnlyCard(page, "Review your booking settings");
  const review = card(page, "Review your booking settings");
  await expect(review.getByText("Online", { exact: true })).toBeVisible();
  await expect(review.getByRole("button", { name: "Confirm and save proposed settings" })).toBeEnabled();
});

test("the identity step and the review work by keyboard alone", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  await reviewableHost(db, host.hostAccountId);
  await acceptSuggestions(db, host.hostAccountId);
  await page.goto("/app");
  const identity = card(page, "What should your booking page show?");
  await expectOnlyCard(page, "What should your booking page show?");

  // The menu's Setup item moves focus to the current step's card.
  await page.getByRole("button", { name: "Open menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Setup" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(identity.getByRole("heading", { name: "What should your booking page show?" })).toBeFocused();

  const tabTo = async (name: string) => {
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "",
      );
      const label = await page.evaluate(() => {
        const element = document.activeElement as HTMLInputElement | null;
        return element?.labels?.[0]?.textContent?.trim() ?? "";
      });
      if (focused === name || label === name) return;
    }
    throw new Error(`Tab never reached ${name}.`);
  };

  const handle = uniqueHandle();
  await tabTo("Handle");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(handle);
  await expect(identity.getByText("Available.")).toBeVisible();
  await tabTo("Save");
  await page.keyboard.press("Enter");

  const review = card(page, "Review your booking settings");
  await expect(review.getByRole("heading", { name: "Review your booking settings" })).toBeFocused();
  await expect(review.getByText(`/${handle}`)).toBeVisible();
  await tabTo("Confirm and save proposed settings");
  await page.keyboard.press("Enter");
  const links = card(page, "You're ready.");
  await expect(links.getByRole("heading", { name: "You're ready." })).toBeFocused();
  await expect(links.getByText(`${baseURL}/${handle}`, { exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`at ${width}px the setup card fits without horizontal scroll`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: width === 1280 ? 800 : 844, width });
    const host = await signedInHost(db, context, baseURL!);
    await reviewableHost(db, host.hostAccountId);
    await acceptSuggestions(db, host.hostAccountId, { displayName: "E2E Host", handle: uniqueHandle() });
    await page.goto("/app");

    await expectOnlyCard(page, "Review your booking settings");
    const review = card(page, "Review your booking settings");
    await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeInViewport();
    // The review scrolls inside itself, with Confirm kept in view.
    await expectCardFits(page);
    await expect(review.getByRole("button", { name: "Confirm and save proposed settings" })).toBeInViewport();
    const [confirmBox, reviewBox] = await Promise.all([
      review.getByRole("button", { name: "Confirm and save proposed settings" }).boundingBox(),
      review.boundingBox(),
    ]);
    expect(confirmBox!.y + confirmBox!.height).toBeLessThanOrEqual(reviewBox!.y + reviewBox!.height + 1);
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    const box = (await page.locator("[data-setup-card]").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);

    // An open editor fits too, with its Save kept in view.
    await review.getByRole("button", { name: "Edit weekly windows" }).click();
    await expectOnlyCard(page, "When can people book you?");
    const windows = card(page, "When can people book you?");
    await windows.getByRole("button", { name: "Adjust" }).click();
    await expect(windows.getByRole("form", { name: "Edit weekly windows" })).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);
    await expectCardFits(page);
    await expect(windows.getByRole("button", { name: "Save windows" })).toBeInViewport();
    // Kept in view inside the card, not clipped by it.
    const [save, cardBox] = await Promise.all([
      windows.getByRole("button", { name: "Save windows" }).boundingBox(),
      windows.boundingBox(),
    ]);
    expect(save!.y + save!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
    await windows.getByRole("button", { name: "Cancel" }).click();
    await expect(windows.getByRole("button", { name: "Adjust" })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeInViewport();
  });
}
