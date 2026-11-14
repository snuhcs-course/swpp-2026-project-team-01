import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { readyRequestHost, runEmails, runEvaluations, sentTo } from "./support/requester";
import { expect as baseExpect, test } from "./support/session";

// The guest's journey from the booking link (guest-flow-completion U6 to U13),
// by keyboard only, at phone and desktop widths: the ink landing names whose
// link it is and offers Start with agent and Continue with web; the web start
// shows two fixed messages and the identity card, with the composer closed, and
// nothing is written or asked of the model until a button is pressed; Continue
// without Google identifies the request and opens the booking page, whose
// thread keeps the two messages and shows the skipped Calendar step as the
// guest's reply; a fixed question asks what the meeting is for and opens the
// composer; the assistant's drafted review (recorded here as its tool would,
// since the model is the local stand-in) is applied with Apply these details,
// which finds times at once; Choose this time and Agree to this proposal
// follow, with exactly one actionable card open after each step; and a reload
// shows the same thread. Evaluations and the creation email run through the
// real job handlers against the fake Google, Routes and Cloudflare.

test.use({ locale: "en-US", timezoneId: "Asia/Seoul" });

// Each step waits on a command and a view refresh, and the first request to a
// route compiles it under next dev while other suites run in parallel.
const expect = baseExpect.configure({ timeout: 30_000 });

// Moves focus with Tab until the focused control's accessible name matches,
// then activates it with the key (Enter by default).
async function press(page: Page, name: RegExp, key = "Enter") {
  for (let step = 0; step < 150; step += 1) {
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return "";
      const labelled = element.getAttribute("aria-labelledby");
      const wrapping = element.closest("label");
      return (
        element.getAttribute("aria-label") ??
        (labelled ? document.getElementById(labelled)?.textContent : null) ??
        (element.textContent || wrapping?.textContent) ??
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

// Exactly `count` actionable cards are open in the thread (DESIGN.md: one thing
// to think about at once); answered and waiting cards are one-line receipts.
async function openCardCount(page: Page, count: number) {
  await expect(page.locator("[data-guest-thread] section[data-guest-card]")).toHaveCount(count);
  await expect(page.locator("section[data-guest-card]")).toHaveCount(count);
}

for (const viewport of [
  { height: 844, width: 390 },
  { height: 900, width: 1280 },
]) {
  test(`a guest goes from the booking link to agreement with the keyboard at ${viewport.width} px`, async ({ db, page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    const host = await readyRequestHost(db, "Ada Lovelace");
    const email = `grace-${randomUUID().slice(0, 8)}@example.test`;
    const requests = async () =>
      (await db<{ count: number }[]>`select count(*)::int as count from app.requests where host_account_id = ${host.hostAccountId}`)[0]!.count;

    // U6: the landing names whose link it is; the agent section stays visible.
    await page.goto(`/${host.handle}`);
    await expect(page.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeVisible();
    await expect(page.getByText("Booking link", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `/${host.handle}/SKILL.md` })).toHaveAttribute("href", `/${host.handle}/SKILL.md`);
    await noHorizontalScroll(page);

    // Start with agent shows the prompt to paste into the guest's own agent.
    await press(page, /^Start with agent$/);
    await expect(page.getByLabel("Prompt for your AI agent")).toContainText(`/${host.handle}/SKILL.md`);

    // U7, U8: the web start's two fixed messages and the identity card; no
    // request exists yet and no message went to the model.
    await press(page, /^Continue with web$/);
    await expect(page.locator('[data-authored-message="greeting"] p:not(:has(span)), [data-authored-message="greeting"] span[aria-hidden="true"]')).toContainText("Hi, I'm Thyme, Ada Lovelace's scheduling assistant.");
    await expect(page.locator('[data-authored-message="google"] p:not(:has(span)), [data-authored-message="google"] span[aria-hidden="true"]')).toContainText("continue with your Google account and Calendar");
    await expect(page.getByRole("heading", { name: "How should the host reach you?" })).toBeVisible();
    await baseExpect(page.locator('[data-guest-card="guest-identity"]').getByRole("link", { name: "How we use your calendar" })).toHaveAttribute(
      "href",
      "/privacy#calendar",
    );
    await expect(page.getByPlaceholder(/Finish the step above/)).toBeDisabled();
    expect(await requests()).toBe(0);
    await noHorizontalScroll(page);

    await press(page, /^Continue without Google$/);
    const identity = page.locator('[data-guest-card="guest-identity"]');
    await typeInto(page, identity.getByLabel("Your name"), "Grace Hopper");
    await typeInto(page, identity.getByLabel("Email address"), email);
    // Cover the reported Enter path at phone width and the button path on desktop.
    if (viewport.width === 390) await page.keyboard.press("Enter");
    else await press(page, /^Continue without Google$/);

    // The booking page, identified, with the creation email on its way.
    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/);
    const [request] = await db<{ id: string; state: string }[]>`select id, state from app.requests where host_account_id = ${host.hostAccountId}`;
    expect(request!.state).toBe("gathering");
    expect(await runEmails(db, request!.id)).toBe(1);
    const [creation] = await sentTo(email);
    expect(creation!.text).toContain(page.url());
    await expect(page.locator('[data-guest-card="identity"]').getByText(`Grace Hopper · ${email}`)).toBeVisible();
    await expect(page.locator('[data-guest-card="calendar"]').getByText("Skipped")).toBeVisible();
    await expect(page.getByText("Hi, I'm Thyme, Ada Lovelace's scheduling assistant.", { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-guest-card="identity"]').getByText(`Grace Hopper · ${email}`)).toBeVisible();
    await expect(page.locator('[data-guest-card="calendar"]').getByText("Skipped")).toBeVisible();

    // U13: the fixed question with what the host offers, and the composer opens.
    await expect(page.getByText("What would you like to meet Ada Lovelace about? Ada Lovelace offers 30-minute meetings", { exact: false })).toBeVisible();
    await openCardCount(page, 0);
    const composer = page.getByPlaceholder("Write to Thyme");
    await typeInto(page, composer, "Talk about compilers, online.");
    // What the assistant's draft_request_review records for that answer.
    const [{ revision }] = await db<{ revision: number }[]>`select revision from app.requests where id = ${request!.id}`;
    await db`
      insert into app.request_reviews (request_id, base_revision, intent, patch, clarifications)
      values (${request!.id}, ${revision}, 'details', ${db.json({ mode: "online", purpose: "Talk about compilers" })}, ${[]})
    `;
    await page.keyboard.press("Enter");
    await expect(page.getByText("Hello from Thyme.").first()).toBeVisible();

    // One review card; Apply these details finds times at once over the next two weeks.
    await expect(page.getByRole("heading", { name: "Apply these details?" })).toBeVisible();
    await openCardCount(page, 1);
    await press(page, /^Apply these details$/);
    await expect.poll(() => runEvaluations(db, request!.id)).toBe(1);
    await expect(page.getByRole("heading", { name: "Choose a time" })).toBeVisible();
    await openCardCount(page, 1);
    const times = page.getByRole("list", { name: "Candidate times" }).getByRole("listitem");
    baseExpect(await times.count()).toBeGreaterThan(1);
    await expect(page.getByText(/Asia\/Seoul \(GMT\+9\) · 30 minutes · Online/).first()).toBeVisible();
    await noHorizontalScroll(page);

    // G7: Choose this time, then Agree to this proposal.
    await press(page, /^Choose this time: /);
    await expect(page.getByRole("heading", { name: "Agree to this time?" })).toBeFocused();
    await expect(page.getByText("A Google Meet link is created when the meeting is booked")).toBeVisible();
    await openCardCount(page, 1);
    await press(page, /^Agree to this proposal$/);

    // G8: waiting for the host, with nothing booked: the waiting card (U22),
    // with Get updates in iMessage as its button (U10).
    const waiting = page.locator('[data-guest-card="awaiting"]');
    await expect(waiting.getByRole("heading", { name: "Waiting for Ada Lovelace to approve" })).toBeVisible();
    await expect(waiting.getByText(/nothing is booked yet/)).toBeVisible();
    await openCardCount(page, 1);
    await expect(page.locator('[data-guest-receipt="answered"]').getByText(/You agreed to/)).toBeVisible();
    await expect(waiting.getByRole("button", { exact: true, name: "Get updates in iMessage" })).toBeVisible();
    const [agreed] = await db<{ state: string; version: number }[]>`
      select r.state, p.version from app.requests r
      join app.proposals p on p.request_id = r.id join app.agreements a on a.proposal_id = p.id
      where r.id = ${request!.id}
    `;
    expect(agreed).toEqual({ state: "awaiting_host_approval", version: 1 });

    // Withdraw request is in the thread's menu beside the composer, by keyboard.
    await press(page, /^Request actions$/);
    await expect(page.getByRole("menuitem", { name: "Withdraw request" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Request actions" })).toBeFocused();

    // A reload loads the same thread from its stored records, cards in place.
    await page.reload();
    await expect(page.getByText("Talk about compilers, online.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Waiting for Ada Lovelace to approve" })).toBeVisible();
    await expect(page.locator('[data-guest-card="calendar"]').getByText("Skipped")).toBeVisible();
    await openCardCount(page, 1);
  });
}
