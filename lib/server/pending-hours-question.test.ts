import { beforeEach, expect, it, vi } from "vitest";
import { database } from "./database";
import { computeEvidence, hoursSuggestion } from "./analysis";
import { pendingHoursQuestion } from "./onboarding-note-step";
const query = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown[]>>());
vi.mock("./database", () => ({ database: () => query }));
beforeEach(() => query.mockReset());
const evidence = computeEvidence([], { timezone: "Asia/Seoul", primaryTimeZone: "Asia/Seoul", hostEmail: "host@example.test", calendars: [], range: { start: new Date("2026-10-01"), end: new Date("2026-11-01") } });
it("exposes the delivered service suggestion outside session history with current/answer state", async () => {
  query.mockResolvedValue([{ evidence, state: "completed", delivery: "accepted", current: true, answered: false }]);
  expect(await pendingHoursQuestion(database(), "host", "binding")).toEqual({ source: "service", suggestion: hoursSuggestion(evidence), timezone: "Asia/Seoul", current: true, delivery: "delivered", waitingForAnswer: true });
  const sql = String(query.mock.calls[0]?.[0]);
  expect(sql).toContain("a.created_at <= o.created_at");
  expect(sql).toContain("newer.created_at > a.created_at");
  expect(query.mock.calls[0]).toContain("onboarding-hours:binding");
});
it("distinguishes stale, undelivered and answered questions instead of authorizing an arbitrary yes", async () => {
  query.mockResolvedValueOnce([{ evidence, state: "completed", delivery: "queued", current: false, answered: true }]);
  expect(await pendingHoursQuestion(database(), "host", "binding")).toMatchObject({ current: false, delivery: "sending", waitingForAnswer: false });
  query.mockResolvedValueOnce([]);
  expect(await pendingHoursQuestion(database(), "host", "binding")).toBeNull();
});
