import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { runCommand } from "../../lib/server/commands";
import { updateDraftCommand } from "../../lib/server/setup-commands";
import { draftRevision, hostCommandDeps } from "../integration/support/setup-host";
import { grantCalendar, reviewableHost, runPendingAnalyses } from "./support/setup-host";
import { expect, signedInHost, test } from "./support/session";

// Host setup in /app (host-onboarding tasks for the cards): the authored
// messages, the step cards, confirmation and the public pages, against the real
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

test("a new host completes setup from the authored messages to working public pages", async ({ baseURL, context, db, page }) => {
  test.setTimeout(120_000);
  const host = await signedInHost(db, context, baseURL!);
  await grantCalendar(db, host.hostAccountId);
  await page.goto("/app");

  // The authored messages open the conversation, then the calendar step's card.
  const log = page.getByRole("log", { name: "Messages" });
  await expect(log.getByText("Hi, I'm Thyme. I'll help you set up how people book one-to-one meetings with you.")).toBeVisible();
  await expect(log.getByText("Your Google Calendar is connected.")).toBeVisible();
  await expect(log.getByText("Next, choose which calendars I check for conflicts and where I add bookings.")).toBeVisible();

  const calendars = card(page, "Choose your calendars");
  await expect(calendars).toBeVisible();
  // Actual calendars by identity: the two "Shared" calendars stay distinct, and the
  // read-only one cannot receive bookings.
  const readOnlyShared = calendars.getByRole("radio", { name: /shared-reader@group\.calendar\.google\.com/ });
  await expect(readOnlyShared).toBeDisabled();
  await expect(readOnlyShared).toHaveAccessibleName(/^Shared.*View only — can't add events$/);
  await expect(calendars.getByRole("radio", { name: /shared-writer@group\.calendar\.google\.com/ })).toBeEnabled();
  await expect(calendars.getByRole("radio", { name: /host@example\.test/ })).toBeChecked();
  await expect(calendars.getByRole("checkbox", { name: /host@example\.test/ })).toBeChecked();
  await expect(calendars.getByRole("checkbox", { name: /Holidays in South Korea/ })).not.toBeChecked();
  await expect(calendars.getByRole("link", { name: /Manage Google connection/ })).toHaveAttribute(
    "href",
    "https://myaccount.google.com/connections",
  );
  await calendars.getByRole("button", { name: "Save calendars" }).click();

  // The disclosed scan, then its evidence once the job has run.
  const analysis = card(page, "Reading your calendars");
  await expect(analysis).toBeVisible();
  await expect(analysis.getByText("This can take a minute.")).toBeVisible();
  await expect(analysis.getByRole("heading", { name: "Reading your calendars" })).toBeFocused();
  expect(await runPendingAnalyses(db, host.hostAccountId)).toBe(1);

  const evidence = card(page, "What your calendar shows");
  await expect(evidence).toBeVisible({ timeout: 15_000 });
  await expect(evidence.getByText("This is evidence for suggestions, never a rule", { exact: false })).toBeVisible();
  await expect(evidence.getByRole("heading", { name: "Preferred times" })).toBeVisible();
  await expect(evidence.getByRole("heading", { name: "Weekly meeting load" })).toBeVisible();
  await expect(evidence.getByText("Focus time", { exact: true })).toBeVisible();
  await expect(evidence.getByText("Blue Bottle Coffee", { exact: true })).toBeVisible();
  // Note-like entries stay busy until the host excludes one.
  const exclude = evidence.getByRole("checkbox", { name: /Exclude from busy time: Focus time/ });
  await expect(exclude).not.toBeChecked();
  await exclude.click();
  await expect(exclude).toBeChecked();

  // Suggestions: inferred values carry their sample, starter defaults say so.
  const windows = card(page, "Weekly windows");
  await expect(windows.getByText(/^Inferred · \d+ meetings$/)).toBeVisible();
  await windows.getByRole("button", { name: "Use this" }).click();
  await expect(windows.getByRole("button", { name: "Edit weekly windows" })).toBeVisible();

  for (const name of ["Time zone", "Meeting length and buffers"]) {
    const suggestion = card(page, name);
    await suggestion.getByRole("button", { name: "Use this" }).click();
    await expect(suggestion.getByRole("button", { name: `Edit ${name.toLowerCase()}` })).toBeVisible();
  }

  const mode = card(page, "Do you prefer online meetings, in-person meetings, or either?");
  await mode.getByRole("button", { name: "Online" }).click();
  await expect(mode.getByText("Your answer: Online")).toBeVisible();
  // Every required value is now present, so the step moves to the review.
  await expect(page.getByRole("heading", { name: "Review your booking settings" })).toBeFocused();
  // Online hides the in-person questions.
  await expect(card(page, "Where do you prefer to meet?")).toHaveCount(0);

  // The review, with the handle edited and checked live.
  const review = card(page, "Review your booking settings");
  await expect(review.getByText("1 excluded from busy time")).toBeVisible();
  const handle = uniqueHandle();
  await review.getByLabel("Handle").fill(handle);
  await expect(review.getByText("Available.")).toBeVisible();
  await review.getByRole("button", { name: "Save handle" }).click();
  await expect(review.getByText(`/${handle}`)).toBeVisible();
  const displayName = await review.getByLabel("Display name").inputValue();
  expect(displayName.length).toBeGreaterThan(0);

  await review.getByRole("button", { name: "Confirm and save proposed settings" }).click();

  const links = card(page, "You're ready.");
  await expect(links).toBeVisible();
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
  const connect = card(page, "Connect Google Calendar");
  await expect(connect.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
    "href",
    "/auth/sign-in?consent=calendar",
  );
  await expect(connect.getByText(/Signed in as host-.+@example\.test/)).toBeVisible();
  await expect(log.getByText("Next, choose which calendars", { exact: false })).toHaveCount(0);
  await expect(card(page, "Choose your calendars")).toHaveCount(0);

  // Unrelated preferences stay editable before Calendar is connected.
  await page.getByRole("button", { name: "Set other preferences now" }).click();
  await expect(card(page, "Meeting length and buffers")).toBeVisible();
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
  await page.goto("/app");

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
  await expect(review.getByText("25 min")).toBeVisible();
  const settings = await db`select 1 from app.host_settings where host_account_id = ${host.hostAccountId}`;
  expect(settings).toHaveLength(0);
  await expect(card(page, "You're ready.")).toHaveCount(0);
});

test("a mode the assistant recorded shows as You said and counts only after Use this", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  await reviewableHost(db, host.hostAccountId);
  // As draft_settings leaves it: stated in the conversation, not accepted on the card.
  await db`
    update app.setup_drafts
    set fields = jsonb_set(fields, '{meetingMode}', ${db.json({ accepted: false, source: "stated", value: "online" })})
    where host_account_id = ${host.hostAccountId}
  `;
  await page.goto("/app");

  const mode = card(page, "Do you prefer online meetings, in-person meetings, or either?");
  await expect(mode.getByText("You said:")).toBeVisible();
  await expect(mode.getByRole("button", { name: "Online" })).toHaveAttribute("aria-pressed", "false");
  await expect(card(page, "Review your booking settings").getByRole("button", { name: "Confirm and save proposed settings" })).toBeDisabled();

  await mode.getByRole("button", { name: "Use this" }).click();

  await expect(mode.getByText("Your answer: Online")).toBeVisible();
  await expect(card(page, "Review your booking settings").getByRole("button", { name: "Confirm and save proposed settings" })).toBeEnabled();
});

test("the review card works by keyboard alone", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  await reviewableHost(db, host.hostAccountId);
  await page.goto("/app");
  const review = card(page, "Review your booking settings");
  await expect(review).toBeVisible();

  // The menu's Setup item moves focus to the current step's card.
  await page.getByRole("button", { name: "Open menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Setup" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(review.getByRole("heading", { name: "Review your booking settings" })).toBeFocused();

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
  await expect(review.getByText("Available.")).toBeVisible();
  await tabTo("Save handle");
  await page.keyboard.press("Enter");
  await expect(review.getByText(`/${handle}`)).toBeVisible();

  await tabTo("Confirm and save proposed settings");
  await page.keyboard.press("Enter");
  const links = card(page, "You're ready.");
  await expect(links.getByRole("heading", { name: "You're ready." })).toBeFocused();
  await expect(links.getByText(`${baseURL}/${handle}`, { exact: true })).toBeVisible();
});

for (const width of [390, 1280]) {
  test(`at ${width}px the setup cards fit without horizontal scroll`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: width === 1280 ? 800 : 760, width });
    const host = await signedInHost(db, context, baseURL!);
    await reviewableHost(db, host.hostAccountId);
    await page.goto("/app");

    const review = card(page, "Review your booking settings");
    await expect(review).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeInViewport();
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // Every card stays inside the viewport's width.
    for (const box of await page.locator("[data-setup-card]").evaluateAll((cards) =>
      cards.map((element) => element.getBoundingClientRect().toJSON() as DOMRect),
    )) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }

    // An open editor fits too.
    const windows = card(page, "Weekly windows");
    await windows.getByRole("button", { name: "Adjust" }).click();
    await expect(windows.getByRole("form", { name: "Edit weekly windows" })).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);
    await windows.getByRole("button", { name: "Cancel" }).click();
    await expect(windows.getByRole("button", { name: "Adjust" })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Message Thyme" })).toBeInViewport();
  });
}
