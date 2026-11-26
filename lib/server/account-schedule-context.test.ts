import { beforeEach, expect, it, vi } from "vitest";
import { createDatabase } from "./database";
import { authorizeSetupTool } from "./setup-tools";
import { readHostSchedule } from "./host-schedule";
import { listHostRequests, readHostTimezone } from "./host-requests";
import { listSentRequests } from "./host-sent-requests";
import { openProposalVersions } from "./host-review-tools";
import { readScheduleForSetupTool } from "./setup-channel-tools";

vi.mock("./setup-tools", async original => ({ ...await original<typeof import("./setup-tools")>(), authorizeSetupTool: vi.fn() }));
vi.mock("./host-schedule", async original => ({ ...await original<typeof import("./host-schedule")>(), readHostSchedule: vi.fn() }));
vi.mock("./host-requests", async original => ({ ...await original<typeof import("./host-requests")>(), listHostRequests: vi.fn(), readHostTimezone: vi.fn() }));
vi.mock("./host-sent-requests", async original => ({ ...await original<typeof import("./host-sent-requests")>(), listSentRequests: vi.fn() }));
vi.mock("./host-review-tools", async original => ({ ...await original<typeof import("./host-review-tools")>(), openProposalVersions: vi.fn() }));
const db = createDatabase("postgres://unused:unused@127.0.0.1:1/unused");
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorizeSetupTool).mockResolvedValue({ id: "owner", kind: "host_account" });
  vi.mocked(readHostTimezone).mockResolvedValue("Asia/Seoul");
  vi.mocked(listSentRequests).mockResolvedValue([]);
  vi.mocked(openProposalVersions).mockResolvedValue(new Map());
});
it("keeps this week's named booking beside an empty next-week schedule without relabeling its week", async () => {
  const today = new Date();
  vi.mocked(listHostRequests).mockResolvedValue([{ bookedStart: today.toISOString(), proposalStart: null, needsDecision: false,
    purpose: "investment", requestId: "4f1c7a52-2b8e-4a36-9b1d-0e6a7d1f2c33", requesterName: "Dohyeon", state: "booked", sample: false, updatedAt: today.toISOString() }]);
  const schedule: Awaited<ReturnType<typeof readHostSchedule>> = { current: { now: "now", thisWeek: "this", nextWeek: "next" }, dataNote: "data", entries: [], googleCalendar: "read", period: { from: "2026-11-30", through: "2026-12-06", timezone: "Asia/Seoul" }, replyNote: "note" };
  vi.mocked(readHostSchedule).mockResolvedValue(schedule);
  const result = await readScheduleForSetupTool({ db, appOrigin: "http://localhost:3000", calendar: { db, tokenKeys: [], config: { apiBaseUrl: "http://127.0.0.1:9", tokenUrl: "http://127.0.0.1:9", clientId: "eval", clientSecret: "eval", timeoutMs: 100 } } },
    { auth: null, sessionId: "account", callId: "read" }, { from: "2026-11-30", days: 7 });
  expect(result.entries).toEqual([]);
  expect(result.nearbyBookings).toMatchObject([{ requester: '"Dohyeon"', purpose: '"investment"', booked: { week: "this_week" } }]);
  expect(result.weekNote).toContain("No meetings are booked next week");
});
