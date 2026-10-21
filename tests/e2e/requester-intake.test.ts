import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { draftIntakeForTool } from "../../lib/server/intake-tools";
import { MONDAY } from "../integration/support/scheduling";
import { readyRequestHost, runEmails, runEvaluations, sentTo } from "./support/requester";
import { expect as baseExpect, test } from "./support/session";

// The requester's journey (tasks 6.3 and 7.1): from a ready host's /{handle}
// through the intake conversation, Continue without Google, applying the
// drafted details on the booking page, Find times, Choose this time and Agree
// to this proposal, using only the keyboard, at phone and desktop widths. The
// model is the local stand-in, which answers in text only, so the intake
// draft is recorded through the real draft_intake tool function, as the model's
// call would; evaluations and the creation email run through the real job
// handlers against the fake Google, Routes and Cloudflare.

test.use({ locale: "en-US", timezoneId: "Asia/Seoul" });

// Each step waits on a command and a view refresh, and the first request to a
// route compiles it under next dev while other suites run in parallel.
const expect = baseExpect.configure({ timeout: 30_000 });

type Database = Parameters<typeof readyRequestHost>[0];

// Moves focus with Tab until the focused control's accessible name matches,
// then activates it with Enter.
async function press(page: Page, name: RegExp, key = "Enter") {
  for (let step = 0; step < 80; step += 1) {
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
  for (let step = 0; step < 80 && !(await field.evaluate((element) => element === document.activeElement)); step += 1) {
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

async function recordIntakeDraft(db: Database, hostAccountId: string) {
  let session: { discussion_id: string; id: string; session_id: string } | undefined;
  await expect
    .poll(async () => {
      [session] = await db<{ discussion_id: string; id: string; session_id: string }[]>`
        select i.id, i.discussion_id, s.session_id from app.intakes i
        join app.agent_sessions s on s.discussion_id = i.discussion_id and s.state = 'active'
        where i.host_account_id = ${hostAccountId}
      `;
      return Boolean(session);
    })
    .toBe(true);

  const outcome = await draftIntakeForTool(
    db,
    {
      auth: { attributes: { audience: "public_intake" }, principalId: `intake:${session!.id}`, principalType: "user" },
      sessionId: session!.session_id,
    },
    { durationMinutes: 30, mode: "online", purpose: "Talk about compilers", windows: [{ date: MONDAY, end: "11:00", start: "10:00" }] },
  );
  expect(outcome.recorded).toBe(true);
}

for (const viewport of [
  { height: 844, width: 390 },
  { height: 900, width: 1280 },
]) {
  test(`a requester goes from the public page to agreement with the keyboard at ${viewport.width} px`, async ({ db, page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    const host = await readyRequestHost(db, "Ada Lovelace");
    const email = `grace-${randomUUID().slice(0, 8)}@example.test`;

    // G0: the public page and its intake conversation.
    await page.goto(`/${host.handle}`);
    await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
    await typeInto(page, page.getByLabel("Message Thyme", { exact: true }), "I'd like 30 minutes online next Monday morning to talk about compilers.");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Hello from Thyme.").first()).toBeVisible();
    await recordIntakeDraft(db, host.hostAccountId);

    // G1: Continue without Google.
    await press(page, /^Continue without Google$/);
    const identity = page.locator('[data-guest-card="guest-identity"]');
    await typeInto(page, identity.getByLabel("Your name"), "Grace Hopper");
    await typeInto(page, identity.getByLabel("Email address"), email);
    await press(page, /^Continue without Google$/);
    await page.waitForURL(/\/booking\/[0-9a-f-]{36}$/);
    await noHorizontalScroll(page);

    const [request] = await db<{ id: string }[]>`select id from app.requests where host_account_id = ${host.hostAccountId}`;
    // The creation email with the booking link goes to the fake Cloudflare.
    expect(await runEmails(db, request!.id)).toBe(1);
    const [creation] = await sentTo(email);
    expect(creation!.text).toContain(page.url());

    // G3: apply the details drafted on the public page.
    await expect(page.getByRole("heading", { name: "Apply these details?" })).toBeVisible();
    await expect(page.getByText("Talk about compilers")).toBeVisible();
    await press(page, /^Apply these details$/);

    // G4: no calendar connection for this requester.
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
    await expect(page.getByRole("heading", { name: "Agree to this time?" })).toBeVisible();
    await expect(page.getByText("A Google Meet link is created when the meeting is booked")).toBeVisible();
    await expect(page.getByText(/Not agreed yet/)).toBeVisible();
    await noHorizontalScroll(page);
    await press(page, /^Agree to this proposal$/);

    // G8: waiting for the host, with nothing booked.
    await expect(page.getByRole("heading", { name: "Waiting for the host to approve" })).toBeVisible();
    await expect(page.getByText(/nothing is booked yet/)).toBeVisible();
    const [agreed] = await db<{ state: string; version: number }[]>`
      select r.state, p.version from app.requests r
      join app.proposals p on p.request_id = r.id join app.agreements a on a.proposal_id = p.id
      where r.id = ${request!.id}
    `;
    expect(agreed).toEqual({ state: "awaiting_host_approval", version: 1 });
  });
}
