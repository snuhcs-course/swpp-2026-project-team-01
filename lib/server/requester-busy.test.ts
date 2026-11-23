import { beforeEach, describe, expect, it, vi } from "vitest";

const grant = vi.fn();
const events = vi.fn();
const guestHost = vi.fn();
vi.mock("./requester-calendar", () => ({ readRequesterCalendarGrant: (...args: unknown[]) => grant(...args), readRequesterEvents: (...args: unknown[]) => events(...args) }));
vi.mock("./requester-host-profiles", () => ({ readGuestHostSource: (...args: unknown[]) => guestHost(...args) }));
vi.mock("./google-calendar", () => ({ openHostCalendar: async () => ({ listEvents: async () => [] }) }));

const { busyRange, readRequesterBusy, RequesterBusyUnavailableError } = await import("./requester-busy");

let standing: { event_id: string }[] = [];
const db = (async () => standing) as never;
const deps = { db, hostCalendar: {} as never, requesterCalendar: {} as never, tokenKeys: [] };
const range = { end: new Date("2026-12-08T00:00:00Z"), start: new Date("2026-11-29T00:00:00Z") };
const event = (overrides: Record<string, unknown>) => ({
  attendees: [],
  end: { dateTime: "2026-12-01T02:00:00Z" },
  hasConferenceLink: false,
  iCalUID: "u",
  id: "e",
  location: "Secret office",
  start: { dateTime: "2026-12-01T01:00:00Z" },
  status: "confirmed",
  summary: "Private dentist",
  transparency: "opaque",
  ...overrides,
});

beforeEach(() => {
  standing = [];
  grant.mockReset();
  events.mockReset();
  guestHost.mockReset().mockResolvedValue(null);
});

describe("the guest's own busy times", () => {
  it("accepts a period of up to 15 days", () => {
    expect(busyRange("2026-11-29T00:00:00Z", "2026-12-08T00:00:00Z")).toEqual(range);
    expect(busyRange("2026-12-08T00:00:00Z", "2026-11-29T00:00:00Z")).toBeNull();
    expect(busyRange("2026-11-01T00:00:00Z", "2026-12-08T00:00:00Z")).toBeNull();
    expect(busyRange(null, "2026-12-08T00:00:00Z")).toBeNull();
  });

  it("shows nothing when the request has no calendar", async () => {
    grant.mockResolvedValue(null);
    await expect(readRequesterBusy(deps, "r1", range, "Asia/Seoul")).resolves.toEqual({ busy: [], connected: false });
    expect(events).not.toHaveBeenCalled();
  });

  it("returns times only, under the evaluation's busy rules", async () => {
    grant.mockResolvedValue({ calendarIds: ["primary"], email: "g@example.com", refreshToken: "t" });
    events.mockResolvedValue([
      event({}),
      event({ id: "free", transparency: "transparent" }),
      event({ attendees: [{ email: "g@example.com", responseStatus: "declined", self: true }], id: "declined" }),
      event({ end: { date: "2026-12-03" }, iCalUID: "d", id: "day", start: { date: "2026-12-02" } }),
    ]);
    const answer = await readRequesterBusy(deps, "r1", range, "Asia/Seoul");
    expect(answer).toEqual({
      busy: [
        { allDay: false, end: "2026-12-01T02:00:00.000Z", start: "2026-12-01T01:00:00.000Z" },
        { allDay: true, end: "2026-12-03", start: "2026-12-02" },
      ],
      connected: true,
    });
    expect(JSON.stringify(answer)).not.toMatch(/dentist|Secret/);
  });

  it("leaves out the booked meeting being changed, as the evaluation does", async () => {
    standing = [{ event_id: "booked" }];
    grant.mockResolvedValue({ calendarIds: ["primary"], email: null, refreshToken: "t" });
    events.mockResolvedValue([event({ iCalUID: "booked@google.com", id: "copy" })]);
    await expect(readRequesterBusy(deps, "r1", range, "Asia/Seoul")).resolves.toEqual({ busy: [], connected: true });
  });

  it("reports a failed read without treating it as free time", async () => {
    grant.mockResolvedValue({ calendarIds: ["primary"], email: null, refreshToken: "t" });
    events.mockRejectedValue(new Error("google"));
    await expect(readRequesterBusy(deps, "r1", range, "Asia/Seoul")).rejects.toBeInstanceOf(RequesterBusyUnavailableError);
  });
});
