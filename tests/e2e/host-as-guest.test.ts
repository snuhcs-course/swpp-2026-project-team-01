import { readyReviewHost } from "./support/host-review";
import { readyRequestHost } from "./support/requester";
import { expect as baseExpect, signedInHost, test } from "./support/session";

// A signed-in host on another host's booking link (host-as-guest-session,
// #183), against the real web service and the local Supabase Auth session:
// the landing recognizes the account, **Continue as {name}** identifies the
// request with the same account, the guest page links back to /app, where the
// host's own workspace is unchanged and the request is listed as sent, and the
// booking link then offers to continue that request.

test.use({ locale: "en-US", timezoneId: "Asia/Seoul" });

const expect = baseExpect.configure({ timeout: 30_000 });

test("a signed-in host books another host with the same account and returns to their workspace", async ({ baseURL, context, db, page }) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  const viewer = await signedInHost(db, context, baseURL!);
  await readyReviewHost(db, viewer.hostAccountId, "Ada Lovelace");
  const other = await readyRequestHost(db, "Barbara Liskov");

  // The landing knows the account.
  await page.goto(`/${other.handle}`);
  await expect(page.getByText("You're signed in as Ada Lovelace")).toBeVisible();
  await page.getByRole("button", { name: "Continue with web" }).click();

  // Continue as the account: no Google consent and no typed details.
  const continueAs = page.getByRole("button", { name: "Continue as Ada Lovelace" });
  await expect(continueAs).toBeVisible();
  await continueAs.click();
  await page.waitForURL(/\/booking\/[0-9a-f-]{36}$/);
  const bookingPath = new URL(page.url()).pathname;

  // Back to the host's own workspace, with its session intact.
  const back = page.getByRole("link", { name: "Back to your workspace" });
  await expect(back).toHaveAttribute("href", "/app");
  await back.click();
  await page.waitForURL(/\/app$/);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Requests" }).click();
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Barbara Liskov/ })).toContainText("Sent request");

  // The booking link now offers to continue that request.
  await page.goto(`/${other.handle}`);
  await expect(page.getByRole("link", { name: "Continue your request" })).toHaveAttribute("href", bookingPath);
  await expect(page.getByRole("button", { name: "Start a new request" })).toBeVisible();
});

test("a signed-in host's own booking link says it is theirs", async ({ baseURL, context, db, page }) => {
  const viewer = await signedInHost(db, context, baseURL!);
  await readyReviewHost(db, viewer.hostAccountId, "Ada Lovelace");
  const [row] = await db<{ handle: string }[]>`
    select handle from app.host_handles where host_account_id = ${viewer.hostAccountId} and released_at is null
  `;

  await page.goto(`/${row!.handle}`);
  await expect(page.getByRole("note")).toContainText("This is your own booking link");
  await expect(page.getByRole("note").getByRole("link", { name: "Back to your workspace" })).toHaveAttribute("href", "/app");
});
