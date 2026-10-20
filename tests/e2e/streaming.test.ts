import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, scriptModelReply, signedInHost, test } from "./support/session";

// Thyme's reply streams into the conversation, against a model stand-in that
// sends its text in delayed word deltas, and a loading indicator holds Thyme's
// place until the first token.

const REPLY =
  "Happy to help you find a time. Tell me who should meet, how long the meeting is, and which days work, and I will look for open slots on your calendar.";

function thymeReply(page: Page) {
  return page
    .getByRole("log", { name: "Messages" })
    .locator("article:not([data-authored-message])")
    .filter({ has: page.getByText("Thyme", { exact: true }) });
}

async function replyLength(page: Page) {
  const reply = thymeReply(page);
  if ((await reply.count()) === 0) return 0;
  return ((await reply.last().textContent()) ?? "").replace(/^Thyme/, "").trim().length;
}

test("Thyme's reply appears progressively while the turn streams, after a thinking indicator", async ({
  baseURL,
  context,
  db,
  page,
}) => {
  await signedInHost(db, context, baseURL!);
  const marker = `stream-${randomUUID()}`;
  // About 3.5 seconds of streamed text.
  await scriptModelReply(marker, { chunkDelayMs: 120, kind: "text", text: REPLY });

  // The message route answers only after the model has begun streaming, as when
  // its round trip to the runtime is slow: the reply must not wait for it.
  let posted = false;
  await page.route("**/api/chat/messages", async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    posted = true;
    await route.fulfill({ response });
  });

  await page.goto("/app");
  const composer = page.getByRole("textbox", { name: "Message Thyme" });
  await expect(composer).toBeEnabled();
  const message = `Help me schedule a meeting. ${marker}`;
  await composer.fill(message);
  await composer.press("Enter");

  // Thyme's slot shows the loading indicator until the first token.
  // The reply's indicator comes after the authored welcome messages, which may
  // still be typing with their own indicator.
  const thinking = page.getByRole("status").filter({ hasText: "Thyme is thinking…" }).last();
  await expect(thinking).toBeVisible();

  // The visible text grows over several observations before the reply is whole.
  const partial: number[] = [];
  let partialBeforePost = false;
  await expect
    .poll(
      async () => {
        const length = await replyLength(page);
        if (length > 0 && length < REPLY.length) {
          if (partial.at(-1) !== length) partial.push(length);
          if (!posted) partialBeforePost = true;
        }
        return length;
      },
      { intervals: [100], timeout: 30_000 },
    )
    .toBe(REPLY.length);

  expect(partial.length).toBeGreaterThanOrEqual(2);
  expect(partial).toEqual([...partial].sort((a, b) => a - b));
  expect(partialBeforePost).toBe(true);

  await expect(composer).toBeEnabled();
  await expect(thinking).toHaveCount(0);
  // The host's message and the reply each appear once.
  const log = page.getByRole("log", { name: "Messages" });
  await expect(log.getByText(message, { exact: true })).toHaveCount(1);
  await expect(thymeReply(page)).toHaveCount(1);
});

test("under reduced motion the thinking indicator is still and says so in words", async ({
  baseURL,
  context,
  db,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signedInHost(db, context, baseURL!);
  const marker = `still-${randomUUID()}`;
  await scriptModelReply(marker, { delayMs: 3_000, kind: "text", text: "Noted." });

  await page.goto("/app");
  const composer = page.getByRole("textbox", { name: "Message Thyme" });
  await expect(composer).toBeEnabled();
  await composer.fill(`Note this. ${marker}`);
  await composer.press("Enter");

  // The reply's indicator comes after the authored welcome messages, which may
  // still be typing with their own indicator.
  const thinking = page.getByRole("status").filter({ hasText: "Thyme is thinking…" }).last();
  await expect(thinking.getByText("Thyme is thinking…")).toBeVisible();
  const dots = thinking.locator(".ld-linear-dots-dot");
  await expect(dots).toHaveCount(3);
  expect(await dots.first().evaluate((dot) => getComputedStyle(dot).animationName)).toBe("none");

  await expect(page.getByRole("log", { name: "Messages" }).getByText("Noted.")).toBeVisible();
  await expect(thinking).toHaveCount(0);
});
