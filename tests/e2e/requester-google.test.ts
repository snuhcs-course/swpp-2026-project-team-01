import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { readyRequestHost, runEvaluations } from "./support/requester";
import { expect as baseExpect, test } from "./support/session";

// The guest's two Google buttons reach the consent screen and come back
// (guest-flow-completion task 1.1, U7, U10, U13): **Continue with Google** on the
// web start of /{handle}, which writes the hidden draft and posts it to
// /connections/google/start, and **Connect Google Calendar** on the booking
// page after the Calendar receipt's **Change**. Both are plain form posts that
// /connections/google/start answers with a redirect to the consent screen. The
// fake Google is that screen and approves at once. The consent answer is one
// value on the fake server, so the tests in this file run one at a time.

test.use({ locale: "en-US", timezoneId: "Asia/Seoul" });
test.describe.configure({ mode: "serial" });

const expect = baseExpect.configure({ timeout: 30_000 });

const FAKE_GOOGLE_ORIGIN = `http://127.0.0.1:${process.env.FAKE_GOOGLE_PORT ?? "3103"}`;

// Sets the fake consent screen's next answer.
async function nextConsent(consent: object) {
  const response = await fetch(`${FAKE_GOOGLE_ORIGIN}/__consent`, { body: JSON.stringify(consent), method: "POST" });
  if (!response.ok) throw new Error(`Setting the fake consent failed with ${response.status}.`);
}

test("a Google guest can reuse their host calendar and basic details", async ({ db, page }) => {
  test.setTimeout(180_000);
  const host = await readyRequestHost(db, "Ada Lovelace");
  const guestHost = await readyRequestHost(db, "Grace Hopper");
  const email = `host-guest-${randomUUID()}@example.test`;
  const userId = randomUUID();
  const subject = `e2e-${randomUUID()}`;
  await db`insert into auth.users (id, email) values (${userId}, ${email})`;
  await db`insert into app.google_identities (google_subject, host_account_id, auth_user_id, email) values (${subject}, ${guestHost.hostAccountId}, ${userId}, ${email})`;
  await db`update app.host_settings set settings = jsonb_set(settings, '{timezone}', '"Europe/London"') where host_account_id = ${guestHost.hostAccountId}`;
  await nextConsent({ decision: "approve", identity: { email, email_verified: true, name: "Grace Hopper", sub: subject }, scopes: ["openid", "email", "profile"] });

  await page.goto(`/${host.handle}`);
  await press(page, /^Continue with web$/);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await press(page, /^Continue with Google$/);
  await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Use your host settings for this request" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Calendars/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Basic details/ })).toBeChecked();
  await press(page, /^Use these settings$/);
  await expect(page.locator('[data-guest-card="host_profile"]')).toContainText("Using your calendars, your basic details");
  await page.reload();
  await expect(page.locator('[data-guest-card="host_profile"]')).toContainText("Using your calendars, your basic details");

  const profile = async () => (await db<{ items: string[]; decided: boolean; settled: boolean; timezone: string }[]>`
    select p.items, p.decided_at is not null as decided, r.calendar_settled_at is not null as settled,
           (select patch ->> 'timezone' from app.request_reviews where request_id = r.id and state = 'pending' limit 1) as timezone
    from app.requester_host_profiles p join app.requests r on r.id = p.request_id
    where r.host_account_id = ${host.hostAccountId}
  `)[0];
  await expect.poll(profile).toEqual({ items: ["calendars", "details"], decided: true, settled: true, timezone: "Europe/London" });
});

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
    const requests = async () =>
      (await db<{ count: number }[]>`select count(*)::int as count from app.requests where host_account_id = ${host.hostAccountId}`)[0]!.count;

    await page.goto(`/${host.handle}`);
    await press(page, /^Continue with web$/);
    await expect(page.getByRole("heading", { name: "How should the host reach you?" })).toBeVisible();
    expect(await requests()).toBe(0);

    // Cancelling the consent returns to the web start with nothing identified.
    await nextConsent({ decision: "deny" });
    await press(page, /^Continue with Google$/);
    await expect(page).toHaveURL(new RegExp(`/${host.handle}$`));
    await expect(page.getByText("Google sign-in was cancelled.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How should the host reach you?" })).toBeVisible();
    const [draft] = await db<{ id: string; state: string }[]>`select id, state from app.requests where host_account_id = ${host.hostAccountId}`;
    expect(draft!.state).toBe("draft");

    // Continue with Google again, granting the name and email but not the
    // calendar: the same draft is identified.
    await nextConsent({
      decision: "approve",
      identity,
      scopes: ["openid", "email", "profile"],
    });
    await press(page, /^Continue with Google$/);

    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Google filled in your name and email.")).toBeVisible();
    await expect(page.locator('[data-guest-card="identity"]').getByText("Continued with Google")).toBeVisible();
    await press(page, /^Request details$/);
    await expect(page.getByRole("complementary", { name: "Request with Ada Lovelace" }).getByText(`Grace Hopper · ${email}`)).toBeVisible();
    await press(page, /^Close details$/);
    const [identified] = await db<{ id: string; state: string; requester_name: string; contact_email: string }[]>`select id, state, requester_name, contact_email from app.requests where host_account_id = ${host.hostAccountId}`;
    expect(identified).toEqual({ id: draft!.id, state: "gathering", requester_name: "Grace Hopper", contact_email: email });
    await expect(page.locator('[data-guest-card="calendar"]').getByText("Skipped")).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-guest-card="identity"]').getByText("Continued with Google")).toBeVisible();
    await expect(page.locator('[data-guest-card="calendar"]').getByText("Skipped")).toBeVisible();

    // U13: the fixed question opens the composer; the assistant's drafted review
    // (recorded as its tool would, the model being the local stand-in) is
    // applied, which finds times without the guest's calendar.
    await typeInto(page, page.getByPlaceholder("Write to Thyme"), "Talk about compilers, online.");
    const [{ revision }] = await db<{ revision: number }[]>`select revision from app.requests where id = ${identified!.id}`;
    await db`
      insert into app.request_reviews (request_id, base_revision, intent, patch, clarifications)
      values (${identified!.id}, ${revision}, 'details', ${db.json({ mode: "online", purpose: "Talk about compilers" })}, ${[]})
    `;
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Apply these details?" })).toBeVisible();
    await press(page, /^Apply these details$/);
    await expect.poll(() => runEvaluations(db, identified!.id)).toBe(1);
    await expect(page.getByRole("heading", { name: "Choose a time" })).toBeVisible();

    // Change on the Calendar receipt offers the Calendar card.
    await press(page, /^Change your calendar$/);
    await expect(page.getByRole("heading", { name: "Check your Google Calendar for times?" })).toBeVisible();

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

    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Google is connected for this request.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Which calendars should count?" })).toBeVisible();
    await expect(page.getByText("Grace's calendar")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Which calendars should count?" })).toBeVisible();
    await expect(page.getByText("Grace's calendar")).toBeVisible();
  });
}
