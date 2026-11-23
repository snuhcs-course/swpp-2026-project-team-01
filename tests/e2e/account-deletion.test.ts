import { makeHostReady } from "../integration/support/ready-host";
import { expect, signedInHost, test } from "./support/session";

type Database = Parameters<typeof makeHostReady>[0];

// A ready host whose confirmed policy is complete, as confirmation saves it, so
// Settings can show it.
async function confirmedHost(db: Database, hostAccountId: string) {
  const { handle } = await makeHostReady(db, hostAccountId);
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
  await db`
    update app.host_settings set settings = settings || ${db.json({
      bufferAfterMinutes: 10,
      bufferBeforeMinutes: 10,
      conflictCalendars: [],
      durationMinutes: 30,
      location: null,
      meetingMode: "online",
      noteExclusions: [],
      provenance: {},
      timezone: "Asia/Seoul",
      travelBufferMinutes: null,
      travelMode: null,
      weeklyLimit: null,
      weeklyWindows: weekdays.map((weekday) => ({ end: "17:00", start: "10:00", weekday })),
    })}
    where host_account_id = ${hostAccountId}
  `;
  return { handle };
}

// Self-service account deletion from Settings (self-service-account-deletion):
// a host signed in through the real local Auth flow opens the Delete account
// card from Thyme's link, is refused a wrong handle, schedules the deletion with
// the right one, and lands signed out on the sign-in card's notice.

for (const width of [390, 1280]) {
  test(`a host schedules their account deletion from Settings at ${width}px`, async ({ baseURL, context, db, page }) => {
    await page.setViewportSize({ height: 900, width });
    const host = await signedInHost(db, context, baseURL!);
    const { handle } = await confirmedHost(db, host.hostAccountId);

    await page.goto("/app?settings=account");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);
    const card = dialog.getByRole("region", { name: "Delete account" });
    // Settings loads its state after opening; the first load compiles routes.
    await expect(card.getByText("Your account will be deleted in 7 days.")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(/Meetings you host stay in your calendar/)).toBeVisible();

    const confirmation = card.getByLabel(`Type @${handle} to confirm`);
    await confirmation.fill("not-my-handle");
    await card.getByRole("button", { name: "Delete my account" }).click();
    await expect(card.getByRole("alert")).toHaveText("That does not match your handle. Type it exactly as it appears.");
    expect((await db`select deletion_due_at from app.host_accounts where id = ${host.hostAccountId}`)[0]!.deletion_due_at).toBeNull();

    await confirmation.fill(`@${handle}`);
    await card.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/app\?deletion=scheduled$/);
    await expect(page.getByRole("status")).toHaveText(
      "Your account will be deleted in 7 days, and we emailed you the date. Signing in again before then cancels the deletion.",
    );
    await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const [account] = await db<{ due: boolean; status: string }[]>`
      select status, deletion_due_at > now() + interval '6 days' as due from app.host_accounts where id = ${host.hostAccountId}
    `;
    expect(account).toEqual({ due: true, status: "active" });

    // The session is gone: /app asks for a sign-in again.
    await page.goto("/app");
    await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  });
}

test("Delete account is a quiet link until the host opens it", async ({ baseURL, context, db, page }) => {
  const host = await signedInHost(db, context, baseURL!);
  await confirmedHost(db, host.hostAccountId);

  await page.goto("/app");
  await page.getByRole("button", { name: "Open settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const link = dialog.getByRole("button", { name: "Delete account", exact: true });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole("region", { name: "Delete account" })).toHaveCount(0);
  expect(await link.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe("underline");

  await link.click();
  const card = dialog.getByRole("region", { name: "Delete account" });
  await expect(card.getByRole("button", { name: "Delete my account" })).toBeDisabled();
  await card.getByRole("button", { name: "Keep my account" }).click();
  await expect(dialog.getByRole("region", { name: "Delete account" })).toHaveCount(0);
  await expect(link).toBeVisible();
});
