import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { hashBookingId, sealBookingLink } from "../../lib/server/booking-links";
import type { Database } from "../../lib/server/database";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { readyRequestHost } from "./support/requester";
import { expect, test } from "./support/session";
import { E2E_TOKEN_ENCRYPTION_KEY } from "./support/token-key";

// **Continue by email** on the booking page (requester-email-channel design 4;
// task 4.2), by keyboard at 390 and 1280 pixels, against the real web and agent
// services and the local stack: a confirmed address gets a one-time code with
// the product inbox, **Check email link** shows the thread once it is bound,
// **Unlink email** ends it, and an unconfirmed address is asked to confirm first.

const tokenKey = parseTokenKey(E2E_TOKEN_ENCRYPTION_KEY);
const INBOX = "findmeatime@agentmail.test";

async function identifiedRequest(db: Database, confirmed: boolean) {
  const host = await readyRequestHost(db);
  const bookingId = randomUUID();
  const email = `grace-${randomUUID().slice(0, 8)}@example.test`;
  const details = { language: "en", timezone: "Asia/Seoul", windows: [] };
  const [request] = await db<{ id: string }[]>`
    insert into app.requests
      (host_account_id, details, requester_name, contact_email, contact_confirmed_email, state, identified_at, expires_at)
    values (${host.hostAccountId}, ${db.json(details)}, 'Grace Hopper', ${email}, ${confirmed ? email : null}, 'gathering', now(),
            now() + interval '7 days')
    returning id
  `;
  const sealed = sealBookingLink(tokenKey, request!.id, bookingId);
  await db`
    insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
    values (${request!.id}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;
  await db`insert into app.discussions (principal_type, principal_id, audience) values ('requester_request', ${request!.id}, 'requester')`;
  return { bookingId, email, requestId: request!.id };
}

async function pressByKeyboard(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
}

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

for (const width of [390, 1280]) {
  test(`at ${width}px a confirmed requester links and unlinks an email thread by keyboard`, async ({ db, page }) => {
    await page.setViewportSize({ height: 800, width });
    const request = await identifiedRequest(db, true);
    await page.goto(`/booking/${request.bookingId}`);

    await pressByKeyboard(page, "Continue by email");
    const card = page.locator('[data-guest-card="email-link"]');
    await expect(card.getByRole("heading", { name: "Continue by email" })).toBeVisible();
    await expect(card).toContainText(INBOX);
    const code = (await card.locator("[data-email-link-code]").textContent())!.trim();
    expect(code).toMatch(/^FMAT-[0-9A-HJKMNP-TV-Z]{10}$/);
    await expect(card.getByRole("link", { name: "Open email" })).toHaveAttribute("href", new RegExp(`^mailto:${INBOX}\\?subject=${code}`));
    expect(await hasNoHorizontalScroll(page)).toBe(true);

    // A reload shows the same pending code.
    await page.reload();
    await expect(page.locator("[data-email-link-code]")).toHaveText(code);

    // The requester sends it; the receipt job binds the thread.
    const [link] = await db<{ id: string }[]>`select id from app.email_links where request_id = ${request.requestId} and state = 'pending'`;
    const [binding] = await db<{ id: string }[]>`
      insert into app.email_threads (request_id, inbox_id, thread_id, origin, sender_hash, bound_by_receipt_id, last_message_id)
      values (${request.requestId}, ${INBOX}, ${`thr_${randomUUID()}`}, 'linked', ${"a".repeat(64)}, ${randomUUID()}, '<m@example.test>')
      returning id
    `;
    await db`
      update app.email_links set state = 'consumed', ended_at = now(), code_ciphertext = null, code_key_id = null,
        thread_binding_id = ${binding!.id}
      where id = ${link!.id}
    `;

    await pressByKeyboard(page, "Check email link");
    await expect(page.locator('[data-email-link="linked"]')).toContainText(`Email linked: replies from g•••@example.test to ${INBOX}`);

    await pressByKeyboard(page, "Unlink email");
    await expect(page.getByRole("button", { name: "Continue by email", exact: true })).toBeVisible();
    const [after] = await db<{ state: string }[]>`select state from app.email_threads where id = ${binding!.id}`;
    expect(after!.state).toBe("unlinked");
    expect(await hasNoHorizontalScroll(page)).toBe(true);
  });
}

test("an unconfirmed requester is asked to confirm first", async ({ db, page }) => {
  const request = await identifiedRequest(db, false);
  await page.goto(`/booking/${request.bookingId}`);
  await expect(page.locator('[data-email-link="needs_confirmation"]')).toContainText("first confirm your address");
  await expect(page.getByRole("button", { name: "Continue by email", exact: true })).toHaveCount(0);
});
