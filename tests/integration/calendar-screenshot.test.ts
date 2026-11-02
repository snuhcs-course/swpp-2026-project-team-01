import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCalendarScreenshotHandler } from "../../lib/server/calendar-screenshot";
import { testDatabase } from "./support/database";
import { guestDependencies, readyHost, startedDraft, ORIGIN } from "./support/guests";

const db = testDatabase();
afterAll(async () => db.end());

function image() {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64");
  return new File([bytes], "calendar.png", { type: "image/png" });
}

function upload(handler: ReturnType<typeof createCalendarScreenshotHandler>, bookingId: string, file: File) {
  const body = new FormData();
  body.set("image", file);
  return handler(new Request(`${ORIGIN}/api/requests/${bookingId}/calendar-screenshot`, {
    body, headers: { origin: ORIGIN }, method: "POST",
  }), { params: Promise.resolve({ bookingId }) });
}

describe("calendar screenshot intake", () => {
  it("authorizes the booking link, returns only review marks, and leaves availability untouched", async () => {
    const host = await readyHost(db);
    const draft = await startedDraft(guestDependencies(db), host.handle);
    const marks = [{ date: "2026-11-09", end: "11:00", interpretation: "unknown" as const, start: "10:00" }];
    const handler = createCalendarScreenshotHandler(() => ({ appOrigin: ORIGIN, db, extract: async () => marks }));

    const response = await upload(handler, draft.bookingId, image());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ marks });
    const [request] = await db<{ details: { windows: unknown[] }; calendar_settled_at: Date | null }[]>`
      select details, calendar_settled_at from app.requests where id = ${draft.requestId}
    `;
    expect(request?.details.windows).toEqual([]);
    expect(request?.calendar_settled_at).toBeNull();

    expect((await upload(handler, randomUUID(), image())).status).toBe(404);
    expect((await upload(handler, draft.bookingId, new File(["not an image"], "fake.png", { type: "image/png" }))).status).toBe(415);
  });

  it("returns a manual fallback when no extractor is configured", async () => {
    const host = await readyHost(db);
    const draft = await startedDraft(guestDependencies(db), host.handle);
    const handler = createCalendarScreenshotHandler(() => ({ appOrigin: ORIGIN, db }));
    const response = await upload(handler, draft.bookingId, image());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/manually/);
  });
});
