import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { draftRequestReviewForTool } from "../../lib/server/request-tools";
import { MONDAY } from "../integration/support/scheduling";
import { readyRequestHost, runEmails, runEvaluations, sentTo } from "./support/requester";
import { expect as baseExpect, test } from "./support/session";

// The guest's journey in one thread (tasks 9.2 and 7.1; design decision 2,
// D13): from a ready host's /{handle}, the first message starts a draft and its
// conversation; the drafted details are applied on the review card in the
// thread; the identity card appears in the thread and Continue without Google
// moves the address bar to the booking link in place, with no page load; then
// Skip for now, Find times, Choose this time and Agree to this proposal, all in
// the same thread, using only the keyboard, at phone and desktop widths; and a
// reload shows the same thread. The model is the local stand-in, which answers
// in text only, so the review is drafted through the real draft_request_review
// tool function, as the model's call would; evaluations and the creation email
// run through the real job handlers against the fake Google, Routes and
// Cloudflare.

test.use({ locale: "en-US", timezoneId: "Asia/Seoul" });

// Each step waits on a command and a view refresh, and the first request to a
// route compiles it under next dev while other suites run in parallel.
const expect = baseExpect.configure({ timeout: 30_000 });

type Database = Parameters<typeof readyRequestHost>[0];

const FIRST_MESSAGE = "I'd like 30 minutes online next Monday morning to talk about compilers.";

// Moves focus with Tab until the focused control's accessible name matches,
// then activates it with Enter.
async function press(page: Page, name: RegExp, key = "Enter") {
  for (let step = 0; step < 150; step += 1) {
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return "";
      const labelled = element.getAttribute("aria-labelledby");
      return (
        element.getAttribute("aria-label") ??
        (labelled ? document.getElementById(labelled)?.textContent : null) ??
        element.textContent ??
        ""
      ).trim();
    });
    if (name.test(focused)) {
      await page.keyboard.press(key);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`No control named ${name} was reached with Tab.`);
}

// Tabs to the field and types into it.
async function typeInto(page: Page, field: Locator, text: string) {
  await expect(field).toBeEnabled();
  for (let step = 0; step < 150 && !(await field.evaluate((element) => element === document.activeElement)); step += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(field).toBeFocused();
  await page.keyboard.type(text);
}

async function noHorizontalScroll(page: Page) {
  const { client, scroll } = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

// Every card and receipt is inside the thread, and the only control below it
// is the composer.
async function cardsInsideThread(page: Page) {
  const outside = await page.evaluate(() => {
    const thread = document.querySelector("[data-guest-thread]");
    return [...document.querySelectorAll("[data-guest-card]")].filter((card) => !thread?.contains(card)).length;
  });
  expect(outside).toBe(0);
  expect(await page.locator("[data-guest-thread] [data-guest-card]").count()).toBeGreaterThan(0);
}

// The draft the first message started, and its live session.
async function draftOf(db: Database, hostAccountId: string) {
  let row: { id: string; session_id: string; state: string } | undefined;
  await expect
    .poll(async () => {
      [row] = await db<{ id: string; session_id: string; state: string }[]>`
        select r.id, r.state, s.session_id from app.requests r
        join app.discussions d on d.principal_type = 'requester_request' and d.principal_id = r.id
        join app.agent_sessions s on s.discussion_id = d.id and s.state = 'active'
        where r.host_account_id = ${hostAccountId}
      `;
      return Boolean(row);
    })
    .toBe(true);
  return row!;
}

for (const viewport of [
  { height: 844, width: 390 },
  { height: 900, width: 1280 },
]) {
  test(`a guest goes from the public page to agreement in one thread with the keyboard at ${viewport.width} px`, async ({ db, page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    const host = await readyRequestHost(db, "Ada Lovelace");
    const email = `grace-${randomUUID().slice(0, 8)}@example.test`;
    // G0: the public page, with the thread and only the composer below it.
    await page.goto(`/${host.handle}`);
    await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
    // Every later page load is recorded; there must be none until the reload at the end.
    const loads: string[] = [];
    page.on("load", () => loads.push(page.url()));
    await expect(page.getByText(/Times are shown in Asia\/Seoul/)).toBeVisible();
    // A marker that only survives while the page is never loaded again.
    await page.evaluate(() => Object.assign(window, { __guestThread: "same page" }));

    await typeInto(page, page.getByLabel("Message Thyme", { exact: true }), FIRST_MESSAGE);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Hello from Thyme.").first()).toBeVisible();

    // The first message started a draft; the address bar stays on the public page.
    const draft = await draftOf(db, host.hostAccountId);
    expect(draft.state).toBe("draft");
    expect(new URL(page.url()).pathname).toBe(`/${host.handle}`);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), `fmat.draft:${host.handle}`)).toMatch(/^[0-9a-f-]{36}$/);

    // G1: the model drafts the details; the next turn shows the review card in the thread.
    const drafted = await draftRequestReviewForTool(
      db,
      {
        auth: { attributes: { audience: "requester" }, principalId: `request:${draft.id}`, principalType: "user" },
        callId: randomUUID(),
        sessionId: draft.session_id,
      },
      {
        details: { durationMinutes: 30, mode: "online", purpose: "Talk about compilers", windows: [{ date: MONDAY, end: "11:00", start: "10:00" }] },
        intent: "details",
      },
    );
    expect(drafted.recorded).toBe(true);
    await typeInto(page, page.getByLabel("Message Thyme", { exact: true }), "Does that work?");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Apply these details?" })).toBeVisible();
    await expect(page.getByText("Talk about compilers", { exact: true })).toBeVisible();
    await cardsInsideThread(page);
    await press(page, /^Apply these details$/);

    // G2: the identity card appears in the thread, and focus moves to it.
    const identityHeading = page.getByRole("heading", { name: "How should the host reach you?" });
    await expect(identityHeading).toBeFocused();
    await expect(page.locator('[data-guest-receipt="answered"]').getByText(/Applied/)).toBeVisible();
    await cardsInsideThread(page);
    await noHorizontalScroll(page);

    await press(page, /^Continue without Google$/);
    const identity = page.locator('[data-guest-card="guest-identity"]');
    await typeInto(page, identity.getByLabel("Your name"), "Grace Hopper");
    await typeInto(page, identity.getByLabel("Email address"), email);
    await press(page, /^Continue without Google$/);

    // The booking link replaces the address in place: no page load since the first message.
    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/);
    expect(await page.evaluate(() => (window as unknown as { __guestThread?: string }).__guestThread)).toBe("same page");
    expect(loads).toEqual([]);
    await expect(page.getByText(FIRST_MESSAGE)).toBeVisible();
    await expect(page.locator('[data-guest-card="identity"]').getByText(`Grace Hopper · ${email}`)).toBeVisible();

    const [request] = await db<{ id: string; state: string }[]>`select id, state from app.requests where host_account_id = ${host.hostAccountId}`;
    expect(request).toEqual({ id: draft.id, state: "gathering" });
    // The creation email with the booking link goes to the fake Cloudflare.
    expect(await runEmails(db, request!.id)).toBe(1);
    const [creation] = await sentTo(email);
    expect(creation!.text).toContain(page.url());

    // G4: no calendar connection for this guest.
    await expect(page.getByRole("heading", { name: "Check your Google Calendar for times?" })).toBeVisible();
    await press(page, /^Skip for now$/);

    // G6: Find times, evaluated by the job.
    await expect(page.getByRole("heading", { name: "Find times that work?" })).toBeVisible();
    await press(page, /^Find times$/);
    await expect(page.getByRole("heading", { name: "Finding times..." })).toBeVisible();
    await expect.poll(() => runEvaluations(db, request!.id)).toBe(1);
    await expect(page.getByRole("heading", { name: "Choose a time" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Candidate times" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText(/Asia\/Seoul \(GMT\+9\) · 30 minutes · Online/).first()).toBeVisible();
    await noHorizontalScroll(page);

    // G7: Choose this time, then Agree to this proposal.
    await press(page, /^Choose this time: .*10:00 GMT\+9 to 10:30 GMT\+9$/);
    await expect(page.getByRole("heading", { name: "Agree to this time?" })).toBeFocused();
    await expect(page.getByText("A Google Meet link is created when the meeting is booked")).toBeVisible();
    await expect(page.getByText(/Not agreed yet/)).toBeVisible();
    await cardsInsideThread(page);
    await noHorizontalScroll(page);
    await press(page, /^Agree to this proposal$/);

    // G8: waiting for the host, with nothing booked.
    await expect(page.getByRole("heading", { name: "Waiting for the host to approve" })).toBeVisible();
    await expect(page.getByText(/nothing is booked yet/)).toBeVisible();
    await expect(page.locator('[data-guest-receipt="answered"]').getByText(/You agreed to/)).toBeVisible();
    const [agreed] = await db<{ state: string; version: number }[]>`
      select r.state, p.version from app.requests r
      join app.proposals p on p.request_id = r.id join app.agreements a on a.proposal_id = p.id
      where r.id = ${request!.id}
    `;
    expect(agreed).toEqual({ state: "awaiting_host_approval", version: 1 });
    expect(loads).toEqual([]);
    await cardsInsideThread(page);

    // A reload loads the same thread from its stored events, cards in place.
    await page.reload();
    await expect(page.getByText(FIRST_MESSAGE)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Waiting for the host to approve" })).toBeVisible();
    await expect(page.locator('[data-guest-card="identity"]')).toBeVisible();
    await cardsInsideThread(page);
  });
}
