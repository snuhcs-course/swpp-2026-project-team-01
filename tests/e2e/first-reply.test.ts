import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { completeGoogleLeg, createGoogleUser } from "../integration/support/auth";
import { clearServiceWindow, db } from "./support/session";

// The Phase 1 join (task 5.1): a new host signs in from the home page through
// the real web routes and the real local Supabase Auth flow, lands on /app with
// an authorized empty setup session the application opened, sends a first
// message and receives a streamed Thyme reply whose provider call was reserved.
//
// Only Google's leg is simulated, as in the other browser tests: when the
// browser asks the web service to start sign-in, the test lets Auth record the
// PKCE flow state, writes what Google's return would have left there, and sends
// the browser to /auth/callback with Auth's code. With E2E_LIVE_MODEL=1 the
// agent service talks to the real gpt-5.6-terra (see playwright.config.ts).

const live = process.env.E2E_LIVE_MODEL === "1";

test.beforeAll(async () => {
  await clearServiceWindow(db);
});

test("a new host signs in, lands on /app with an empty setup session and gets Thyme's first reply", async ({
  baseURL,
  page,
}) => {
  test.setTimeout(live ? 180_000 : 60_000);
  const user = await createGoogleUser(db);

  await page.route("**/auth/sign-in", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const authorize = new URL(response.headers().location!);
    const toGoogle = await fetch(authorize, { redirect: "manual" });
    expect(new URL(toGoogle.headers.get("location")!).hostname).toBe("accounts.google.com");
    const code = await completeGoogleLeg(db, authorize.searchParams.get("code_challenge")!, user.userId, {
      accessToken: `ya29.${randomUUID()}`,
      refreshToken: null,
    });
    await route.fulfill({ headers: { ...response.headers(), location: `${baseURL}/auth/callback?code=${code}` }, response });
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Sign in with Google" }).click();
  await page.waitForURL((url) => url.pathname === "/app" && url.search === "");
  const composer = page.getByRole("textbox", { name: "Message Thyme" });
  await expect(composer).toBeEnabled();

  // Exactly one host account, and an indexed, authorized, empty setup session.
  const accounts = await db<{ id: string }[]>`
    select a.id from app.host_accounts a join app.google_identities i on i.host_account_id = a.id
    where i.auth_user_id = ${user.userId}
  `;
  expect(accounts).toHaveLength(1);
  const hostAccountId = accounts[0]!.id;
  const sessions = await db<{ session_id: string; generation: number; state: string; current_input_id: string | null }[]>`
    select s.session_id, s.generation, s.state, s.current_input_id
    from app.agent_sessions s join app.discussions d on d.id = s.discussion_id
    where d.principal_type = 'host_account' and d.principal_id = ${hostAccountId} and d.audience = 'host_setup'
  `;
  expect(sessions).toEqual([{ current_input_id: null, generation: 1, session_id: expect.any(String), state: "active" }]);
  const [opened] = await db<{ count: number }[]>`
    select count(*)::int as count from app.command_outcomes
    where actor = ${`host_account:${hostAccountId}`} and operation = 'open_setup_discussion'
  `;
  expect(opened!.count).toBe(1);

  await composer.fill("Hi Thyme. In one short sentence, what can you help me with?");
  await composer.press("Enter");

  const reply = page
    .getByRole("log", { name: "Messages" })
    .getByRole("article")
    .filter({ has: page.getByText("Thyme", { exact: true }) });
  if (live) {
    await expect(reply).toHaveCount(1, { timeout: 120_000 });
  } else {
    await expect(reply.getByText("Hello from Thyme.")).toBeVisible();
  }
  await expect(composer).toBeEnabled({ timeout: live ? 120_000 : 30_000 });

  // The reply arrived as the runtime's stream events, read back through the
  // application's history route with the browser's own session.
  const history = await page.request.get("/api/chat/events?cursor=0");
  expect(history.ok()).toBe(true);
  const events = (await history.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; data?: { message?: string } });
  const types = events.map((event) => event.type);
  expect(types).toContain("message.appended");
  expect(types).toContain("turn.completed");
  const replyText = events.find((event) => event.type === "message.completed")?.data?.message?.trim() ?? "";
  expect(replyText.length).toBeGreaterThan(0);

  // The reply's provider call was reserved against the accepted input and session.
  const reservations = await db<{ amount_usd: string; session_id: string; work_id: string }[]>`
    select r.amount_usd, r.session_id, r.work_id
    from app.model_reservations r join app.conversation_inputs i on i.id = r.work_id
    where r.work_kind = 'conversation_input' and r.principal_id = ${hostAccountId}
  `;
  expect(reservations.length).toBeGreaterThanOrEqual(1);
  expect(reservations.every((row) => row.session_id === sessions[0]!.session_id && row.amount_usd === "0.60")).toBe(true);

  console.log(
    JSON.stringify({
      events: types.length,
      live,
      messageAppended: types.filter((type) => type === "message.appended").length,
      reply: replyText,
      reservations: reservations.length,
    }),
  );
});
