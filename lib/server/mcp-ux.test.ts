import intakeTools from "../../agent/tools/intake";
import type { DynamicResolveContext } from "eve/tools";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { scheduleOverridesSchema, STARTER_DEFAULTS, type WeeklyWindow } from "../contracts/setup";
import { setupNextStep } from "./setup-tools";
import { HOST_TOOLS } from "./agent-host-tools";
import { evaluateFeasibility, hostPreviewIntervals, weeklyWindowsOnDate } from "./feasibility";
import { computeSlotPreview } from "./slot-preview";
import { channelReplies } from "./channel-texts";

const base: WeeklyWindow[] = [{ weekday: "monday", start: "10:00", end: "17:00" }];
const afternoon: WeeklyWindow[] = [{ weekday: "monday", start: "14:00", end: "18:00" }];
const rules = { alternateWeeks: { anchorWeek: "2026-12-28", windows: afternoon }, weeks: [{ weekStart: "2027-01-11", windows: [] }] };
const host = { weeklyWindows: base, scheduleOverrides: rules, timezone: "UTC", bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
  meetingMode: "online" as const, travelMode: null, travelBufferMinutes: null, weeklyLimit: null, weeklyLimitCounts: "bookings" as const };

describe("MCP setup recovery", () => {
  it("offers the intake tool only to host setup and host review sessions", async () => {
    for (const audience of ["host_setup", "host_review", "requester", null]) {
      const current = audience ? { principalType: "user", principalId: "host", attributes: { audience, requestId: "request" } } : null;
      const ctx = { session: { auth: { current } } } as unknown as DynamicResolveContext;
      const resolved = await intakeTools.events["session.started"]!({}, ctx);
      expect(Object.keys(resolved ?? {})).toEqual(audience?.startsWith("host_") ? ["set_request_intake"] : []);
    }
  });
  it("guides a ready host to confirm a pending draft, or fill missing fields first", () => {
    expect(setupNextStep("ready", "https://test", { pendingChanges: true, missingFields: [] })).toContain("confirm_setup");
    expect(setupNextStep("ready", "https://test", { pendingChanges: true, missingFields: ["location"] })).toContain("missingFields");
    expect(setupNextStep("ready", "https://test", { pendingChanges: false, missingFields: [] })).toContain("Setup is complete");
    expect(setupNextStep("connect_calendar", "https://test", { pendingChanges: true, missingFields: [] })).toContain("connect Google Calendar");
  });
  it("requires scoped, revisioned, explicit intake instructions", () => {
    const tool = HOST_TOOLS.find(tool => tool.name === "set_request_intake")!;
    expect(tool.scope).toBe("host:write");
    const valid = { accepting: false, expectedRevision: 3, retryKey: "pause-123456", hostWords: "Pause new requests" };
    expect(tool.input.safeParse(valid).success).toBe(true);
    for (const field of ["hostWords", "expectedRevision", "retryKey"]) {
      const invalid: Record<string, unknown> = { ...valid }; delete invalid[field];
      expect(tool.input.safeParse(invalid).success).toBe(false);
    }
    expect(tool.input.safeParse({ ...valid, hostWords: " " }).success).toBe(false);
  });
});

describe("week schedule overrides", () => {
  it("rejects non-Mondays, impossible dates, duplicate weeks and oversized lists", () => {
    expect(scheduleOverridesSchema.safeParse(rules).success).toBe(true);
    for (const date of ["2026-12-29", "2027-02-29", "not-a-date"]) {
      expect(scheduleOverridesSchema.safeParse({ ...rules, alternateWeeks: { ...rules.alternateWeeks, anchorWeek: date } }).success).toBe(false);
    }
    expect(scheduleOverridesSchema.safeParse({ ...rules, weeks: [rules.weeks[0], rules.weeks[0]] }).success).toBe(false);
    expect(scheduleOverridesSchema.safeParse({ ...rules, weeks: Array(105).fill(rules.weeks[0]) }).success).toBe(false);
  });
  it("uses dated replacements before alternating hours in both directions across years", () => {
    expect(weeklyWindowsOnDate(host, "2026-12-14")).toEqual(afternoon);
    expect(weeklyWindowsOnDate(host, "2026-12-21")).toEqual(base);
    expect(weeklyWindowsOnDate(host, "2026-12-28")).toEqual(afternoon);
    expect(weeklyWindowsOnDate(host, "2027-01-04")).toEqual(base);
    expect(weeklyWindowsOnDate(host, "2027-01-11")).toEqual([]);
    expect(weeklyWindowsOnDate({ weeklyWindows: base }, "2026-12-28")).toEqual(base);
  });
  it("applies the same closed week to preview and candidate evaluation", () => {
    const range = { start: new Date("2027-01-11T00:00:00Z"), end: new Date("2027-01-12T00:00:00Z") };
    expect(hostPreviewIntervals(host, [], range, 30)).toEqual([]);
    const result = evaluateFeasibility({ host, now: new Date("2027-01-01Z"), hostBusy: [], requesterBusy: null,
      request: { durationMinutes: 30, mode: "online", timezone: "UTC", windows: [range], location: null, travelMode: null, linkPlan: null } });
    expect(result.candidates).toEqual([]);
  });
  it("preserves an overnight window from its start week", () => {
    const overnight = { ...host, scheduleOverrides: { alternateWeeks: null, weeks: [{ weekStart: "2026-12-28", windows: [{ weekday: "sunday" as const, start: "23:00", end: "02:00" }] }] } };
    const intervals = hostPreviewIntervals(overnight, [], { start: new Date("2027-01-04T00:00Z"), end: new Date("2027-01-04T03:00Z") }, 30);
    expect(intervals).toEqual([{ start: Date.parse("2027-01-04T00:00Z"), end: Date.parse("2027-01-04T02:00Z") }]);
  });
  it("subtracts calendar busy time and buffers from overridden hours", () => {
    const intervals = hostPreviewIntervals({ ...host, bufferAfterMinutes: 15 }, [{
      start: Date.parse("2026-12-28T14:00Z"), end: Date.parse("2026-12-28T15:00Z"), allDay: false,
      meeting: false, endpoint: { kind: "unknown", reason: "no_location" },
    }], { start: new Date("2026-12-28T00:00Z"), end: new Date("2026-12-29T00:00Z") }, 30);
    expect(intervals).toEqual([{ start: Date.parse("2026-12-28T15:00Z"), end: Date.parse("2026-12-28T18:00Z") }]);
  });
  it("applies DST ambiguity rules to an exceptional week too", () => {
    const dst = { ...host, timezone: "America/New_York", scheduleOverrides: { alternateWeeks: null, weeks: [{ weekStart: "2026-10-26", windows: [{ weekday: "sunday" as const, start: "01:30", end: "02:30" }] }] } };
    expect(hostPreviewIntervals(dst, [], { start: new Date("2026-11-01T00:00Z"), end: new Date("2026-11-02T00:00Z") }, 30)).toEqual([]);
  });
  it("clips this week's preview to now and captions it as this week without asking to confirm", () => {
    const preview = computeSlotPreview({ ...host, weeklyWindows: STARTER_DEFAULTS.weeklyWindows, scheduleOverrides: undefined,
      durationMinutes: 30, travelMode: null, place: null, reviewRef: "ABCDEF" }, [], new Date("2026-11-25T13:07Z"), "this_week");
    expect(preview.weekStart).toBe("2026-11-23");
    expect(preview.days[0].open).toEqual([]);
    expect(preview.days[2].open).toEqual([{ start: "13:15", end: "20:00" }]);
    expect(channelReplies("en").onboarding.slotSummary(preview)).toContain("This week's");
    expect(channelReplies("en").onboarding.slotSummary(preview)).not.toContain("Shall I open");
    expect(channelReplies("ko").onboarding.slotSummary(preview)).toContain("이번 주");
  });
  it("retains the calendar-change reproposal and host-consent instruction", () => {
    const instruction = readFileSync(new URL("../../agent/instructions/host-setup.ts", import.meta.url), "utf8");
    expect(instruction).toContain("Their hours stay until they agree");
    expect(instruction).toContain("do not offer it again");
  });
});
