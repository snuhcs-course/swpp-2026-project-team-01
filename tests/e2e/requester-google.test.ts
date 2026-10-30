import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { askForIdentityForTool, draftRequestReviewForTool } from "../../lib/server/request-tools";
import { MONDAY } from "../integration/support/scheduling";
import { readyRequestHost } from "./support/requester";
import { expect as baseExpect, test } from "./support/session";

// The guest's two Google buttons reach the consent screen and come back to the
// same thread (guest-flow-completion task 1.1): **Continue with Google** on the
// identity card at /{handle} and **Connect Google Calendar** on the calendar
// card at /booking/[bookingId], both plain form posts to
// /connections/google/start, which answers with a redirect to the consent
// screen. The fake Google is that screen and approves at once. The consent
// answer is one value on the fake server, so the tests in this file run one
// at a time.

test.use({ locale: "en-US", timezoneId: "Asia/Seoul" });
test.describe.configure({ mode: "serial" });

const expect = baseExpect.configure({ timeout: 30_000 });

type Database = Parameters<typeof readyRequestHost>[0];

const FAKE_GOOGLE_ORIGIN = `http://127.0.0.1:${process.env.FAKE_GOOGLE_PORT ?? "3103"}`;

// Sets the fake consent screen's next answer.
async function nextConsent(consent: object) {
  const response = await fetch(`${FAKE_GOOGLE_ORIGIN}/__consent`, { body: JSON.stringify(consent), method: "POST" });
  if (!response.ok) throw new Error(`Setting the fake consent failed with ${response.status}.`);
}

// Moves focus with Tab until the focused control's accessible name matches,
// then activates it with Enter.
async function press(page: Page, name: RegExp) {
  for (let step = 0; step < 150; step += 1) {
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return "";
      return (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
    });
    if (name.test(focused)) {
      await page.keyboard.press("Enter");
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

// The draft the first message started, and its live session.
async function draftOf(db: Database, hostAccountId: string) {
  let row: { id: string; session_id: string } | undefined;
  await expect
    .poll(async () => {
      [row] = await db<{ id: string; session_id: string }[]>`
        select r.id, s.session_id from app.requests r
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
  test(`a guest continues with Google and connects Google Calendar with the keyboard at ${viewport.width} px`, async ({ db, page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    const host = await readyRequestHost(db, "Ada Lovelace");
    const email = `grace-${randomUUID().slice(0, 8)}@example.test`;
    const identity = { email, email_verified: true, name: "Grace Hopper", sub: `e2e-${randomUUID()}` };
    const message = "I'd like 30 minutes online next Monday morning to talk about compilers.";

    await page.goto(`/${host.handle}`);
    await typeInto(page, page.getByLabel("Message Thyme", { exact: true }), message);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Hello from Thyme.").first()).toBeVisible();

    // The model drafts the details and asks for a name and email, through the
    // real tool functions; the next turn opens the identity card.
    const draft = await draftOf(db, host.hostAccountId);
    const call = () => ({
      auth: { attributes: { audience: "requester" }, principalId: `request:${draft.id}`, principalType: "user" },
      callId: randomUUID(),
      sessionId: draft.session_id,
    });
    await draftRequestReviewForTool(db, call(), {
      details: { durationMinutes: 30, mode: "online", purpose: "Talk about compilers", windows: [{ date: MONDAY, end: "11:00", start: "10:00" }] },
      intent: "details",
    });
    await askForIdentityForTool(db, call());
    await typeInto(page, page.getByLabel("Message Thyme", { exact: true }), "Does that work?");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "How should the host reach you?" })).toBeFocused();

    // Continue with Google, granting the name and email but not the calendar,
    // so the calendar card asks again later.
    await nextConsent({
      decision: "approve",
      identity,
      scopes: ["openid", "email", "profile"],
    });
    await press(page, /^Continue with Google$/);

    // Back in the same thread, now at the booking link.
    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}\?google=identified$/);
    await expect(page.getByText("Google filled in your name and email. Your request continues here.")).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.locator('[data-guest-card="identity"]').getByText(`Grace Hopper · ${email}`)).toBeVisible();
    const [identified] = await db<{ state: string }[]>`select state from app.requests where id = ${draft.id}`;
    expect(identified).toEqual({ state: "gathering" });

    // A page load starts focus at the top; the open card is the drafted details.
    await expect(page.getByRole("heading", { name: "Apply these details?" })).toBeVisible();
    await press(page, /^Apply these details$/);

    // Connect Google Calendar, granting the calendar this time; its refresh
    // token reads one primary calendar.
    await expect(page.getByRole("heading", { name: "Check your Google Calendar for times?" })).toBeFocused();
    const refreshToken = `1//e2e-guest-${randomUUID()}`;
    const fixture = await fetch(`${FAKE_GOOGLE_ORIGIN}/__fixture/${encodeURIComponent(refreshToken)}`, {
      body: JSON.stringify({
        calendars: [{ accessRole: "owner", id: email, primary: true, summary: "Grace's calendar", timeZone: "Asia/Seoul" }],
        events: { [email]: [] },
      }),
      method: "POST",
    });
    expect(fixture.ok).toBe(true);
    await nextConsent({
      decision: "approve",
      identity,
      refreshToken,
    });
    await press(page, /^Connect Google Calendar$/);

    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}\?google=connected$/);
    await expect(page.getByText("Google is connected for this request.")).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Which calendars should count?" })).toBeVisible();
    await expect(page.getByText("Grace's calendar")).toBeVisible();
  });
}
